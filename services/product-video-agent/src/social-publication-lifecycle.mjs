import {
  SOCIAL_SOURCE_PUBLICATION_SELECT,
  normalizeRuntimePublication,
} from './publication-runtime-snapshot.mjs';

const SOURCE_CANCELLED_STATES = new Set(['deleted', 'revision_requested', 'withdrawn']);
const CHILD_PENDING_STATES = new Set(['queued', 'scheduled']);
const CHILD_DELIVERY_STARTED_STATES = new Set(['publishing', 'published']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWorkflowState(publication = {}) {
  return normalizeText(publication.metadata?.workflow_state || publication.status).toLowerCase();
}

function buildSourceLifecyclePatch(childPublication = {}, sourcePublication = {}, asOf = '') {
  const childState = normalizeWorkflowState(childPublication);
  const sourceState = normalizeWorkflowState(sourcePublication);
  const sourceScheduledFor = normalizeText(sourcePublication.scheduled_for);
  const childScheduledFor = normalizeText(childPublication.scheduled_for);
  const hasExternalId = Boolean(normalizeText(childPublication.external_id));
  const lifecycleMetadata = {
    ...(childPublication.metadata || {}),
    source_workflow_state: sourceState,
    source_scheduled_for: sourceScheduledFor,
    source_lifecycle_checked_at: asOf,
  };

  if (SOURCE_CANCELLED_STATES.has(sourceState)) {
    const targetState = sourceState === 'deleted' ? 'deleted' : 'withdrawn';
    if (!hasExternalId && (childState === targetState || childState === 'deleted')) return null;
    if (hasExternalId || CHILD_DELIVERY_STARTED_STATES.has(childState)) {
      const reason = `source_${sourceState}_after_delivery_started`;
      if (
        childPublication.metadata?.source_lifecycle_action_required === false
        && normalizeText(childPublication.metadata?.source_lifecycle_resolved_at)
      ) return null;
      if (
        childPublication.metadata?.source_lifecycle_action_required === true
        && childPublication.metadata?.source_lifecycle_reason === reason
      ) return null;
      return {
        patch: {
          metadata: {
            ...lifecycleMetadata,
            source_lifecycle_action_required: true,
            source_lifecycle_reason: reason,
            source_lifecycle_alert_status: 'pending',
            source_lifecycle_alert_requested_at: asOf,
          },
        },
        action: 'source_lifecycle_manual_action_required',
      };
    }
    return {
      patch: {
        status: targetState,
        scheduled_for: null,
        metadata: {
          ...lifecycleMetadata,
          workflow_state: targetState,
          source_lifecycle_action_required: false,
          source_lifecycle_reason: `source_${sourceState}_before_delivery`,
          source_lifecycle_applied_at: asOf,
        },
      },
      action: `source_lifecycle_${targetState}`,
    };
  }

  if (
    CHILD_PENDING_STATES.has(childState)
    && !hasExternalId
    && sourceScheduledFor
    && sourceScheduledFor !== childScheduledFor
  ) {
    return {
      patch: {
        status: 'scheduled',
        scheduled_for: sourceScheduledFor,
        metadata: {
          ...lifecycleMetadata,
          workflow_state: 'scheduled',
          source_lifecycle_action_required: false,
          source_lifecycle_reason: 'source_schedule_changed',
          source_lifecycle_applied_at: asOf,
        },
      },
      action: 'source_schedule_synchronized',
    };
  }

  return null;
}

async function loadSourcePublicationMap(store, publications) {
  const sourcePublicationIds = [...new Set(
    publications
      .map((publication) => normalizeText(publication.metadata?.source_publication_id))
      .filter(Boolean),
  )];
  if (typeof store.fetchPublicationsByIds !== 'function') return new Map();
  const sourceRows = await store.fetchPublicationsByIds(sourcePublicationIds, {
    select: SOCIAL_SOURCE_PUBLICATION_SELECT,
    queryClass: 'social_lifecycle_sources',
  });
  return new Map(
    sourceRows
      .map(normalizeRuntimePublication)
      .filter((publication) => publication?.id)
      .map((publication) => [publication.id, publication]),
  );
}

export async function reconcileAdditionalPlatformPublicationLifecycles({
  store,
  publications = [],
  asOf = new Date().toISOString(),
  dryRun = false,
}) {
  if (!store?.fetchPublicationById || !store?.updatePublication) {
    throw new Error('Platform lifecycle reconciliation requires publication fetch and update support.');
  }
  const sourceCache = await loadSourcePublicationMap(store, publications);
  const reconciledPublications = [];
  const results = [];

  for (const publication of publications) {
    const sourcePublicationId = normalizeText(publication.metadata?.source_publication_id);
    if (!sourcePublicationId) {
      reconciledPublications.push(publication);
      continue;
    }
    if (!sourceCache.has(sourcePublicationId) && typeof store.fetchPublicationsByIds !== 'function') {
      sourceCache.set(sourcePublicationId, await store.fetchPublicationById(sourcePublicationId));
    }
    const sourcePublication = sourceCache.get(sourcePublicationId);
    if (!sourcePublication) {
      reconciledPublications.push(publication);
      continue;
    }
    let lifecyclePublication = publication;
    let lifecycle = buildSourceLifecyclePatch(lifecyclePublication, sourcePublication, asOf);
    if (!lifecycle) {
      reconciledPublications.push(publication);
      continue;
    }
    if (!dryRun && publication._metadata_complete === false) {
      lifecyclePublication = await store.fetchPublicationById(publication.id) || publication;
      lifecycle = buildSourceLifecyclePatch(lifecyclePublication, sourcePublication, asOf);
      if (!lifecycle) {
        reconciledPublications.push(lifecyclePublication);
        continue;
      }
    }
    const updatedPublication = dryRun
      ? {
        ...lifecyclePublication,
        ...lifecycle.patch,
        metadata: lifecycle.patch.metadata || lifecyclePublication.metadata || {},
      }
      : await store.updatePublication(publication.id, lifecycle.patch) || lifecyclePublication;
    reconciledPublications.push(updatedPublication);
    results.push({
      publication_id: publication.id,
      platform: publication.platform || '',
      account_key: publication.account_key || '',
      action: dryRun ? `${lifecycle.action}_due` : lifecycle.action,
      workflow_state: normalizeWorkflowState(updatedPublication),
      source_publication_id: sourcePublicationId,
      source_workflow_state: normalizeWorkflowState(sourcePublication),
      scheduled_for: updatedPublication.scheduled_for || '',
    });
  }

  return { publications: reconciledPublications, results };
}
