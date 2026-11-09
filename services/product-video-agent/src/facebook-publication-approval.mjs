import { stat } from 'node:fs/promises';
import {
  FACEBOOK_GRAPH_DELIVERY_PROVIDER,
  FACEBOOK_REEL_APPROVAL_VERSION,
  FACEBOOK_REEL_PLATFORM,
} from './facebook-publication.mjs';
import { resolveAvailablePublicationRender } from './publication-render-path.mjs';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';

function normalizeText(value) {
  return String(value || '').trim();
}

function requireFacebookApprovalIdentity(target = {}, reviewedSettings = {}) {
  const pageId = normalizeText(
    reviewedSettings.pageId
      || target.facebook?.page_id
      || target.facebook?.pageId,
  );
  const expectedPageName = normalizeText(
    reviewedSettings.expectedPageName
      || target.facebook?.expected_page_name
      || target.facebook?.expectedPageName,
  );
  if (!pageId || !expectedPageName) {
    throw new Error(
      `Facebook target ${target.accountKey || target.account_key || ''} requires page_id and expected_page_name.`,
    );
  }
  return { pageId, expectedPageName };
}

export async function addFacebookReelApproval({
  row,
  target,
  approval,
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
}) {
  if (row.platform !== FACEBOOK_REEL_PLATFORM || !approval?.approvedAt) {
    return row;
  }
  const reviewedSettings = (Array.isArray(approval.facebookReels)
    ? approval.facebookReels
    : []).find((item) => normalizeText(item?.accountKey) === row.account_key);
  if (!reviewedSettings) {
    throw new Error(
      `Facebook target ${row.account_key} was not included in the shared publication review.`,
    );
  }
  const identity = requireFacebookApprovalIdentity(target, reviewedSettings);
  const { renderPath, fileStats } = await resolveAvailablePublicationRender({
    configuredPath: row.metadata?.render_path,
    projectRoot,
    statImpl,
  });
  const videoSha256 = await hashFileImpl(renderPath);
  return {
    ...row,
    metadata: {
      ...(row.metadata || {}),
      render_path: renderPath,
      facebook_reel_approval: {
        version: FACEBOOK_REEL_APPROVAL_VERSION,
        approved: true,
        approved_at: approval.approvedAt,
        approved_by: normalizeText(approval.approvedBy),
        approved_by_id: normalizeText(approval.approvedById),
        source_review_task_id: normalizeText(approval.reviewTaskId),
        publication_id: row.id,
        video_id: row.video_id,
        account_key: row.account_key,
        delivery_provider: target.delivery_provider
          || target.deliveryProvider
          || FACEBOOK_GRAPH_DELIVERY_PROVIDER,
        page_id: identity.pageId,
        expected_page_name: identity.expectedPageName,
        render_path: renderPath,
        video_size_bytes: Number(fileStats.size),
        video_sha256: videoSha256,
        description: String(reviewedSettings.description ?? ''),
      },
    },
  };
}
