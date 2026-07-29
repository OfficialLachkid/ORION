import { createStableId } from './ids.mjs';
import {
  OperatorScriptInputSchema,
  OutputManifestSchema,
  ScriptJobSchema,
  ScriptRevisionSchema,
  ScriptVariantSchema,
  VoiceOverJobSchema,
  WorkflowApprovalSchema,
} from './schemas.mjs';
import { attachScriptVariantsToApprovals } from './workflow-approvals.mjs';

function assertOperatorAudit(options) {
  if (!String(options.actor || '').trim()) {
    throw new Error('Script revision requires an operator identity.');
  }
  if (!String(options.reason || '').trim()) {
    throw new Error('Script revision requires a reason.');
  }
}

export function createOperatorScriptFallback(manifestInput, options) {
  const manifest = OutputManifestSchema.parse(manifestInput);
  const content = OperatorScriptInputSchema.parse(options.content);
  const scriptJob = manifest.script_jobs.find((item) => (
    item.script_job_id === options.scriptJobId
  ));
  if (!scriptJob) {
    throw new Error(`Script job ${options.scriptJobId} was not found.`);
  }
  if (manifest.script_variants.some((item) => (
    item.product_id === scriptJob.product_id && item.angle === scriptJob.angle
  ))) {
    throw new Error(`Script job ${options.scriptJobId} already has a script variant.`);
  }
  assertOperatorAudit(options);

  const spokenText = `${content.hook} ${content.body} ${content.call_to_action}`;
  const scriptVariant = ScriptVariantSchema.parse({
    script_variant_id: createStableId('script-variant', {
      scriptJobId: scriptJob.script_job_id,
      provider: 'operator_revision',
    }),
    product_id: scriptJob.product_id,
    angle: scriptJob.angle,
    target_duration_seconds: scriptJob.target_duration_seconds,
    ...content,
    affiliate_disclosure: scriptJob.creative_brief.disclosure,
    spoken_text: spokenText,
    generation_provider: 'operator_revision',
    model: 'operator-reviewed',
    status: 'awaiting_approval',
    approval_status: 'pending',
    created_at: options.revisedAt,
  });
  const completedJob = ScriptJobSchema.parse({
    ...scriptJob,
    status: 'completed',
  });
  const revision = ScriptRevisionSchema.parse({
    revision_id: createStableId('script-revision', {
      scriptVariantId: scriptVariant.script_variant_id,
      spokenText,
      revisedAt: options.revisedAt,
    }),
    script_variant_id: scriptVariant.script_variant_id,
    previous_spoken_text: 'No local-model draft passed deterministic validation.',
    revised_spoken_text: spokenText,
    revised_by: options.actor,
    reason: options.reason,
    revised_at: options.revisedAt,
  });
  const voiceOverJobs = manifest.voice_over_jobs.map((job) => (
    job.script_job_id === scriptJob.script_job_id
      ? VoiceOverJobSchema.parse({
          ...job,
          script_variant_id: scriptVariant.script_variant_id,
          blockers: [
            'script_variant_approval_pending',
            'local_tts_execution_not_enabled',
          ],
        })
      : job
  ));
  const workflowApprovals = attachScriptVariantsToApprovals(
    manifest.workflow_approvals,
    [completedJob],
    [scriptVariant],
  );

  return OutputManifestSchema.parse({
    ...manifest,
    mode: 'local_preview',
    script_jobs: manifest.script_jobs.map((job) => (
      job.script_job_id === completedJob.script_job_id ? completedJob : job
    )),
    script_variants: [...manifest.script_variants, scriptVariant],
    script_revisions: [...manifest.script_revisions, revision],
    voice_over_jobs: voiceOverJobs,
    workflow_approvals: workflowApprovals,
    notes: [
      ...manifest.notes,
      `Operator ${options.actor} created fallback script ${scriptVariant.script_variant_id} after local-model validation failure: ${options.reason}`,
    ],
  });
}

export function applyOperatorScriptRevision(manifestInput, options) {
  const manifest = OutputManifestSchema.parse(manifestInput);
  const content = OperatorScriptInputSchema.parse(options.content);
  const variant = manifest.script_variants.find((item) => (
    item.script_variant_id === options.scriptVariantId
  ));
  if (!variant) {
    throw new Error(`Script variant ${options.scriptVariantId} was not found.`);
  }
  assertOperatorAudit(options);

  const spokenText = `${content.hook} ${content.body} ${content.call_to_action}`;
  const revisedVariant = ScriptVariantSchema.parse({
    ...variant,
    ...content,
    spoken_text: spokenText,
    generation_provider: 'operator_revision',
    status: 'awaiting_approval',
    approval_status: 'pending',
  });
  const revision = ScriptRevisionSchema.parse({
    revision_id: createStableId('script-revision', {
      scriptVariantId: variant.script_variant_id,
      spokenText,
      revisedAt: options.revisedAt,
    }),
    script_variant_id: variant.script_variant_id,
    previous_spoken_text: variant.spoken_text,
    revised_spoken_text: spokenText,
    revised_by: options.actor,
    reason: options.reason,
    revised_at: options.revisedAt,
  });
  const workflowApprovals = manifest.workflow_approvals.map((approval) => {
    if (approval.stage !== 'script' || approval.subject_id !== variant.script_variant_id) {
      return approval;
    }
    return WorkflowApprovalSchema.parse({
      ...approval,
      state: 'pending',
      blocking_reasons: [],
      decided_at: null,
      decided_by: null,
      decision_reason: '',
    });
  });

  return OutputManifestSchema.parse({
    ...manifest,
    script_variants: manifest.script_variants.map((item) => (
      item.script_variant_id === variant.script_variant_id ? revisedVariant : item
    )),
    script_revisions: [...manifest.script_revisions, revision],
    workflow_approvals: workflowApprovals,
    notes: [
      ...manifest.notes,
      `Operator revised script ${variant.script_variant_id}; approval was reset to pending.`,
    ],
  });
}
