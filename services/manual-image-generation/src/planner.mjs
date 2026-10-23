import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  dimensionsForAspectRatio,
  MANUAL_IMAGE_MAX_COUNT,
  ManualImageRequestSchema,
} from './request.mjs';

const PlanImageSchema = z.object({
  index: z.number().int().min(1).max(MANUAL_IMAGE_MAX_COUNT),
  label: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(4000),
  seed: z.number().int().nonnegative(),
});

export const ManualImagePlanSchema = z.object({
  schema_version: z.literal('1.0'),
  status: z.enum(['ready', 'clarification_required']),
  inferred_count: z.number().int().min(0).max(MANUAL_IMAGE_MAX_COUNT),
  aspect_ratio: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  shared_style_context: z.string().trim().max(1500),
  consistency_constraints: z.array(z.string().trim().min(1).max(300)).max(12),
  transparent_background: z.boolean(),
  clarification_message: z.string().trim().max(1000),
  images: z.array(PlanImageSchema).max(MANUAL_IMAGE_MAX_COUNT),
  planner: z.object({
    provider: z.enum(['ollama', 'deterministic']),
    model: z.string().min(1),
    execution: z.literal('local'),
    estimated_cost: z.literal(0),
  }),
}).superRefine((plan, context) => {
  if (plan.status === 'ready' && plan.images.length !== plan.inferred_count) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['images'],
      message: 'Ready plans must contain exactly inferred_count image prompts.',
    });
  }
  if (plan.status === 'clarification_required' && !plan.clarification_message) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clarification_message'],
      message: 'Clarification plans require a message for the operator.',
    });
  }
});

function assertLocalEndpoint(endpoint) {
  const url = new URL(endpoint || 'http://127.0.0.1:11434');
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('Manual image planning must use the local Ollama endpoint.');
  }
  return url;
}

function planJsonSchema(maximumCount) {
  const string = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'status',
      'inferred_count',
      'shared_style_context',
      'consistency_constraints',
      'clarification_message',
      'images',
    ],
    properties: {
      status: { type: 'string', enum: ['ready', 'clarification_required'] },
      inferred_count: { type: 'integer', minimum: 0, maximum: maximumCount },
      shared_style_context: { type: 'string', maxLength: 1500 },
      consistency_constraints: { type: 'array', maxItems: 12, items: string },
      clarification_message: { type: 'string', maxLength: 1000 },
      images: {
        type: 'array',
        maxItems: maximumCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'label', 'prompt'],
          properties: {
            index: { type: 'integer', minimum: 1, maximum: maximumCount },
            label: { type: 'string', minLength: 1, maxLength: 100 },
            prompt: { type: 'string', minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
  };
}

function stableSeed(jobId, index) {
  return Number.parseInt(createHash('sha256').update(`${jobId}:${index}`).digest('hex').slice(0, 8), 16);
}

function finalizePlan(rawPlan, request, options) {
  const dimensions = dimensionsForAspectRatio(request.aspect_ratio);
  const maximumCount = options.maximumCount || MANUAL_IMAGE_MAX_COUNT;
  const explicitCount = request.count;
  const inferredCount = explicitCount ?? Number(rawPlan.inferred_count || 0);
  if (rawPlan.status === 'clarification_required') {
    return ManualImagePlanSchema.parse({
      schema_version: '1.0',
      status: 'clarification_required',
      inferred_count: 0,
      aspect_ratio: request.aspect_ratio,
      ...dimensions,
      shared_style_context: rawPlan.shared_style_context || '',
      consistency_constraints: rawPlan.consistency_constraints || [],
      transparent_background: request.transparent_background,
      clarification_message: rawPlan.clarification_message || '',
      images: [],
      planner: {
        provider: 'ollama',
        model: options.model,
        execution: 'local',
        estimated_cost: 0,
      },
    });
  }
  if (inferredCount < 1 || inferredCount > maximumCount) {
    throw new Error(`The local planner must choose between 1 and ${maximumCount} images.`);
  }
  if (explicitCount !== null && Number(rawPlan.inferred_count) !== explicitCount) {
    throw new Error(`The local planner changed the explicit image count from ${explicitCount}.`);
  }
  const images = (rawPlan.images || []).map((image, index) => ({
    index: index + 1,
    label: image.label,
    prompt: image.prompt,
    seed: stableSeed(options.jobId, index + 1),
  }));
  return ManualImagePlanSchema.parse({
    schema_version: '1.0',
    status: 'ready',
    inferred_count: inferredCount,
    aspect_ratio: request.aspect_ratio,
    ...dimensions,
    shared_style_context: rawPlan.shared_style_context || '',
    consistency_constraints: rawPlan.consistency_constraints || [],
    transparent_background: request.transparent_background,
    clarification_message: rawPlan.clarification_message || '',
    images,
    planner: {
      provider: 'ollama',
      model: options.model,
      execution: 'local',
      estimated_cost: 0,
    },
  });
}

export function buildDeterministicManualImagePlan(requestInput, options) {
  const request = ManualImageRequestSchema.parse(requestInput);
  if (request.count === null) {
    throw new Error('A deterministic plan requires an explicit image count.');
  }
  const dimensions = dimensionsForAspectRatio(request.aspect_ratio);
  const consistency = request.count > 1
    ? ['Keep subject identity, visual style, palette, lighting, and canvas treatment consistent across every image.']
    : [];
  if (request.transparent_background) {
    consistency.push('Render one isolated subject on a perfectly flat #ff00ff chroma background with no shadows or scenery.');
  }
  const context = request.count > 1 ? 'Coherent image set requested by the operator.' : 'Single operator-requested image.';
  return ManualImagePlanSchema.parse({
    schema_version: '1.0',
    status: 'ready',
    inferred_count: request.count,
    aspect_ratio: request.aspect_ratio,
    ...dimensions,
    shared_style_context: context,
    consistency_constraints: consistency,
    transparent_background: request.transparent_background,
    clarification_message: '',
    images: Array.from({ length: request.count }, (_, index) => ({
      index: index + 1,
      label: request.count === 1 ? 'Generated image' : `Image ${index + 1}`,
      prompt: [request.prompt, context, ...consistency, request.count > 1 ? `This is image ${index + 1} of ${request.count}.` : '']
        .filter(Boolean)
        .join(' '),
      seed: stableSeed(options.jobId, index + 1),
    })),
    planner: {
      provider: 'deterministic',
      model: 'explicit-count-fallback',
      execution: 'local',
      estimated_cost: 0,
    },
  });
}

export async function createManualImagePlan(requestInput, options) {
  const request = ManualImageRequestSchema.parse(requestInput);
  const maximumCount = Math.min(options.maximumCount || MANUAL_IMAGE_MAX_COUNT, MANUAL_IMAGE_MAX_COUNT);
  const endpoint = assertLocalEndpoint(options.endpoint);
  const model = String(options.model || 'llama3.1:8b');
  const explicitInstruction = request.count === null
    ? `Infer the smallest useful image count between 1 and ${maximumCount}.`
    : `The operator explicitly requested exactly ${request.count} images. You must return that count.`;
  const messages = [
    {
      role: 'system',
      content: [
        'You are ORION manual image planning. Return only JSON matching the response schema.',
        explicitInstruction,
        'Decompose separate assets, variants, or ordered stages into one self-contained prompt per output image.',
        'Do not turn one requested scene into multiple images unless the request clearly asks for separate outputs.',
        'Keep shared style, palette, subject identity, canvas treatment, and viewpoint consistent where relevant.',
        request.transparent_background
          ? 'Every image must request one isolated subject on a perfectly flat #ff00ff chroma background, with no scenery, floor, border, text, or shadow.'
          : 'Preserve the background treatment requested by the operator.',
        'If the request cannot be decomposed confidently, set status to clarification_required, inferred_count to 0, images to [], and ask one concise question.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt: request.prompt,
        explicit_count: request.count,
        aspect_ratio: request.aspect_ratio,
        transparent_background: request.transparent_background,
      }),
    },
  ];
  try {
    const response = await (options.fetchImpl || fetch)(new URL('/api/chat', endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs || 180_000),
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: 0,
        format: planJsonSchema(maximumCount),
        options: { temperature: 0 },
        messages,
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Local planner returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    const envelope = JSON.parse(body);
    const rawPlan = JSON.parse(String(envelope.message?.content || '').trim());
    return finalizePlan(rawPlan, request, { ...options, model, maximumCount });
  } catch (error) {
    if (request.count !== null) {
      return buildDeterministicManualImagePlan(request, options);
    }
    throw new Error(`ORION could not infer a safe image plan: ${error.message}`);
  }
}
