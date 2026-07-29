import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureProductProviderAdapter } from '../src/adapters/fixture-adapter.mjs';
import {
  findScriptQualityIssues,
  OllamaScriptAdapter,
} from '../src/adapters/ollama-script-adapter.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { generateLocalScriptPreview } from '../src/local-preview.mjs';
import { runProductVideoDryRun } from '../src/pipeline.mjs';
import { inspectProductVideoRuntime } from '../src/runtime-readiness.mjs';
import {
  applyOperatorScriptRevision,
  createOperatorScriptFallback,
} from '../src/script-revisions.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');
const inputFile = 'services/product-video-agent/fixtures/example-product.json';
const configFile = 'services/product-video-agent/config.example.json';

async function createDryRun() {
  const config = await loadPipelineConfig(configFile, projectRoot);
  const adapter = new FixtureProductProviderAdapter({ projectRoot });
  const result = await runProductVideoDryRun({
    adapter,
    config,
    inputFile,
    projectRoot,
  });
  return { config, manifest: result.manifest };
}

test('local preview creates pending short-form scripts without unlocking downstream actions', async () => {
  const { manifest } = await createDryRun();
  const contentByAngle = {
    problem_solution: [
      'Dust hides where a cloth cannot reach.',
      'A focused air stream clears narrow desk gaps.',
      'The reusable tool is ready for the next dusty corner.',
    ],
    demonstration: [
      'Watch the loose debris move between these keys.',
      'Interchangeable nozzles direct air around compact equipment.',
      'A broader attachment handles the open surface afterward.',
    ],
    novelty: [
      'One rechargeable tool replaces another disposable can.',
      'USB-C charging keeps the handheld air source reusable.',
      'Different brush heads add another way to loosen dust.',
    ],
  };
  const scriptAdapter = {
    async checkReadiness() {
      return { status: 'ready', detail: 'Local fixture model is ready.' };
    },
    async generateVariant({ product, scriptJob, runAt }) {
      const [hook, body, callToAction] = contentByAngle[scriptJob.angle];
      return {
        script_variant_id: `script-variant-${scriptJob.angle}`,
        product_id: product.product_id,
        angle: scriptJob.angle,
        target_duration_seconds: scriptJob.target_duration_seconds,
        hook,
        body,
        call_to_action: callToAction,
        affiliate_disclosure: scriptJob.creative_brief.disclosure,
        spoken_text: `${hook} ${body} ${callToAction}`,
        generation_provider: 'fixture-local',
        model: 'fixture-model',
        status: 'awaiting_approval',
        approval_status: 'pending',
        created_at: runAt,
      };
    },
  };
  const result = await generateLocalScriptPreview({ manifest, scriptAdapter });

  assert.equal(result.manifest.mode, 'local_preview');
  assert.equal(result.manifest.script_variants.length, 3);
  assert.ok(result.manifest.script_jobs.every((job) => job.status === 'completed'));
  assert.ok(result.manifest.script_jobs.every((job) => job.model_plan.execute === true));
  assert.ok(result.manifest.script_variants.every((variant) => variant.approval_status === 'pending'));
  assert.ok(result.manifest.voice_over_jobs.every((job) => job.blockers.includes('script_variant_approval_pending')));
  assert.ok(result.manifest.publications.every((publication) => publication.status === 'blocked'));
  assert.equal(result.manifest.external_calls.model, 'local_executed');
  assert.equal(result.manifest.cost.incurred, 0);
});

test('operator fallback creates one pending script when every local-model draft failed', async () => {
  const { manifest } = await createDryRun();
  const selectedJob = manifest.script_jobs[0];
  const fallback = createOperatorScriptFallback(manifest, {
    scriptJobId: selectedJob.script_job_id,
    content: {
      hook: 'One drawer becomes a guessing game when every cable looks the same.',
      body: 'A small thermal printer sends a black-and-white label from a phone over Bluetooth.',
      call_to_action: 'Each cable gets a clear name before it returns to the drawer.',
    },
    actor: 'operator-test',
    reason: 'All local-model retries failed deterministic validation.',
    revisedAt: '2026-07-27T12:10:00.000Z',
  });

  const variant = fallback.script_variants[0];
  const approval = fallback.workflow_approvals.find((item) => (
    item.stage === 'script' && item.subject_id === variant.script_variant_id
  ));
  const voiceJob = fallback.voice_over_jobs.find((item) => (
    item.script_job_id === selectedJob.script_job_id
  ));

  assert.equal(fallback.mode, 'local_preview');
  assert.equal(variant.generation_provider, 'operator_revision');
  assert.equal(variant.approval_status, 'pending');
  assert.equal(approval.state, 'pending');
  assert.equal(voiceJob.script_variant_id, variant.script_variant_id);
  assert.equal(fallback.script_revisions[0].revised_by, 'operator-test');
  assert.equal(
    fallback.script_jobs.find((item) => item.script_job_id === selectedJob.script_job_id).status,
    'completed',
  );
});

test('local preview blocks duplicate scripts across creative angles', async () => {
  const { manifest } = await createDryRun();
  const scriptAdapter = {
    async checkReadiness() {
      return { status: 'ready', detail: 'Local fixture model is ready.' };
    },
    async generateVariant({ product, scriptJob, runAt }) {
      return {
        script_variant_id: `script-variant-${scriptJob.angle}`,
        product_id: product.product_id,
        angle: scriptJob.angle,
        target_duration_seconds: scriptJob.target_duration_seconds,
        hook: 'Same hook.',
        body: 'Same body.',
        call_to_action: 'Same closing.',
        affiliate_disclosure: scriptJob.creative_brief.disclosure,
        spoken_text: 'Same hook. Same body. Same closing.',
        generation_provider: 'fixture-local',
        model: 'fixture-model',
        status: 'awaiting_approval',
        approval_status: 'pending',
        created_at: runAt,
      };
    },
  };

  await assert.rejects(
    generateLocalScriptPreview({ manifest, scriptAdapter }),
    /duplicate wording/u,
  );
});

test('local preview blocks near-duplicate scripts across creative angles', async () => {
  const { manifest } = await createDryRun();
  let index = 0;
  const drafts = [
    'Dust sits around keyboard keys. A rechargeable air duster includes four nozzles and two brush heads. It replaces disposable canned air.',
    'Dust sits around keyboard keys. A rechargeable air duster comes with four nozzles and two brush heads. It replaces disposable canned air.',
  ];
  const scriptAdapter = {
    async checkReadiness() {
      return { status: 'ready', detail: 'Local fixture model is ready.' };
    },
    async generateVariant({ product, scriptJob, runAt }) {
      const spokenText = drafts[Math.min(index, drafts.length - 1)];
      index += 1;
      return {
        script_variant_id: `script-variant-${scriptJob.angle}`,
        product_id: product.product_id,
        angle: scriptJob.angle,
        target_duration_seconds: scriptJob.target_duration_seconds,
        hook: 'Dust sits around keyboard keys.',
        body: 'A rechargeable air duster includes four nozzles and two brush heads.',
        call_to_action: 'It replaces disposable canned air.',
        affiliate_disclosure: scriptJob.creative_brief.disclosure,
        spoken_text: spokenText,
        generation_provider: 'fixture-local',
        model: 'fixture-model',
        status: 'awaiting_approval',
        approval_status: 'pending',
        created_at: runAt,
      };
    },
  };

  await assert.rejects(
    generateLocalScriptPreview({ manifest, scriptAdapter }),
    /near-duplicate wording/u,
  );
});

test('Ollama adapter requires loopback and emits schema-valid pending scripts', async () => {
  const { config, manifest } = await createDryRun();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        async json() {
          return { models: [{ name: config.script.model }] };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return {
          response: JSON.stringify({
            hook: 'Still using canned air?',
            body: 'This rechargeable air duster has three modes and USB-C charging.',
            closing_line: 'Three airflow modes cover the documented desk-cleaning uses.',
          }),
        };
      },
    };
  };
  const adapter = new OllamaScriptAdapter(config.script, { fetchImpl });
  const readiness = await adapter.checkReadiness();
  const variant = await adapter.generateVariant({
    product: manifest.products[0],
    scriptJob: manifest.script_jobs[0],
    runAt: manifest.run_at,
  });
  const requestBody = JSON.parse(requests[1].options.body);

  assert.equal(readiness.status, 'ready');
  assert.equal(variant.approval_status, 'pending');
  assert.doesNotMatch(variant.spoken_text, /affiliate links/u);
  assert.match(variant.affiliate_disclosure, /affiliate links/u);
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.think, false);
  assert.equal(requestBody.options.seed, 42);
  assert.equal(requestBody.options.temperature, 0.2);
  assert.equal(requestBody.options.num_ctx, 4096);
  assert.equal(requestBody.format.properties.body.type, 'string');
  assert.equal(requestBody.format.properties.closing_line.type, 'string');
  assert.equal(requestBody.format.properties.call_to_action, undefined);
  assert.equal(requestBody.format.additionalProperties, false);
  assert.match(requestBody.prompt, /Never say our, we, or us/u);
  assert.throws(
    () => new OllamaScriptAdapter({ ...config.script, endpoint: 'https://ollama.example.com' }),
    /must be local/u,
  );
});

test('Ollama adapter supports an explicit local thinking profile', async () => {
  const { config, manifest } = await createDryRun();
  let requestBody;
  const adapter = new OllamaScriptAdapter({
    ...config.script,
    thinking: true,
  }, {
    async fetchImpl(_url, options) {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            response: JSON.stringify({
              hook: 'A rechargeable air source reaches between keyboard keys.',
              body: 'The handheld air duster charges over USB-C and has three selectable modes.',
              closing_line: 'It replaces another disposable can around a desk.',
            }),
          };
        },
      };
    },
  });

  await adapter.generateVariant({
    product: manifest.products[0],
    scriptJob: manifest.script_jobs[0],
    runAt: manifest.run_at,
  });

  assert.equal(requestBody.think, true);
  assert.equal(requestBody.options.num_predict, 1024);
});

test('operator revision is audited, narration-only, and resets script approval', async () => {
  const { manifest } = await createDryRun();
  const preview = await generateLocalScriptPreview({
    manifest,
    scriptAdapter: {
      async checkReadiness() {
        return { status: 'ready', detail: 'Fixture model ready.' };
      },
      async generateVariant({ product, scriptJob, runAt }) {
        return {
          script_variant_id: `script-variant-${scriptJob.angle}`,
          product_id: product.product_id,
          angle: scriptJob.angle,
          target_duration_seconds: scriptJob.target_duration_seconds,
          hook: `Old ${scriptJob.angle} hook.`,
          body: `Old ${scriptJob.angle} body.`,
          call_to_action: `Old ${scriptJob.angle} closing.`,
          affiliate_disclosure: scriptJob.creative_brief.disclosure,
          spoken_text: `Old ${scriptJob.angle} hook. Old ${scriptJob.angle} body. Old ${scriptJob.angle} closing.`,
          generation_provider: 'fixture-local',
          model: 'fixture-model',
          status: 'awaiting_approval',
          approval_status: 'pending',
          created_at: runAt,
        };
      },
    },
  });
  const selected = preview.manifest.script_variants[1];
  const revised = applyOperatorScriptRevision(preview.manifest, {
    scriptVariantId: selected.script_variant_id,
    content: {
      hook: 'One speaker that splits into two?',
      body: 'Place each half on opposite sides of the room.',
      call_to_action: 'Would you try this?',
    },
    actor: 'operator-test',
    reason: 'Use curiosity and viewer-relevant benefits.',
    revisedAt: '2026-07-21T12:00:00.000Z',
  });
  const variant = revised.script_variants.find((item) => (
    item.script_variant_id === selected.script_variant_id
  ));
  const approval = revised.workflow_approvals.find((item) => (
    item.stage === 'script' && item.subject_id === selected.script_variant_id
  ));

  assert.equal(variant.generation_provider, 'operator_revision');
  assert.equal(variant.spoken_text, 'One speaker that splits into two? Place each half on opposite sides of the room. Would you try this?');
  assert.doesNotMatch(variant.spoken_text, /affiliate/u);
  assert.equal(variant.affiliate_disclosure, manifest.affiliate_links[0].disclosure);
  assert.equal(revised.script_revisions.length, 1);
  assert.equal(approval.state, 'pending');
  assert.throws(
    () => applyOperatorScriptRevision(preview.manifest, {
      scriptVariantId: selected.script_variant_id,
      content: {
        hook: 'One speaker that splits into two?',
        body: 'This content contains affiliate links.',
        call_to_action: 'Would you try this?',
      },
      actor: 'operator-test',
      reason: 'Invalid disclosure-in-narration test.',
      revisedAt: '2026-07-21T12:01:00.000Z',
    }),
    /cannot be narrated/u,
  );
});

test('Ollama adapter retries drafts that imply affiliation or unsupported capabilities', async () => {
  const { config, manifest } = await createDryRun();
  let generationCalls = 0;
  const seeds = [];
  const adapter = new OllamaScriptAdapter(config.script, {
    async fetchImpl(url, options) {
      generationCalls += 1;
      seeds.push(JSON.parse(options.body).options.seed);
      const generated = generationCalls === 1
        ? {
            hook: 'Meet our seamless speaker.',
            body: 'Connect two devices at once.',
            closing_line: 'Would you try this?',
          }
        : {
            hook: 'This magnetic speaker splits into two units.',
            body: 'The S11-M provides 20 W total output and Bluetooth 5.3.',
            closing_line: 'Each half can fill a different side of the room.',
          };
      return {
        ok: true,
        async json() {
          return { response: JSON.stringify(generated) };
        },
      };
    },
  });
  manifest.script_jobs[0].creative_brief.blocked_phrases = ['connect two devices'];
  const variant = await adapter.generateVariant({
    product: manifest.products[0],
    scriptJob: manifest.script_jobs[0],
    runAt: manifest.run_at,
  });

  assert.equal(generationCalls, 2);
  assert.deepEqual(seeds, [42, 43]);
  assert.deepEqual(findScriptQualityIssues(variant, ['connect two devices']), []);
  assert.match(variant.body, /20 W total output/u);
});

test('script quality checks reject advertorial identity and engagement endings', () => {
  const issues = findScriptQualityIssues({
    hook: 'Meet the Cordless Mini Air Duster by Example Labs.',
    body: 'This versatile tool is perfect for desks.',
    call_to_action: 'What else can you clean with this?',
  }, [], { brand: 'Example Labs' });

  assert.ok(issues.includes('advertorial product introduction'));
  assert.ok(issues.includes('brand/company mention: Example Labs'));
  assert.ok(issues.includes('generic promotional description'));
  assert.ok(issues.includes('promotional adjective or superlative'));
  assert.ok(issues.includes('question-style closing line'));
  assert.ok(issues.includes('generic engagement question'));
});

test('script quality checks accept a factual editorial closing', () => {
  const issues = findScriptQualityIssues({
    hook: 'Dust trapped between keyboard keys is hard to reach.',
    body: 'A rechargeable air stream clears the gaps without another disposable can.',
    call_to_action: 'Three airflow modes keep the same tool useful around a desk setup.',
  }, [], { brand: 'Example Labs' });

  assert.deepEqual(issues, []);
});

test('checked-in air-duster revision passes the editorial quality gate', async () => {
  const fixturePath = resolve(
    projectRoot,
    'services/product-video-agent/fixtures/example-product-editorial-script.json',
  );
  const script = JSON.parse(await readFile(fixturePath, 'utf8'));

  assert.deepEqual(findScriptQualityIssues(script, [], { brand: 'Example Labs' }), []);
});

test('checked-in T150 revision passes the editorial quality gate', async () => {
  const content = JSON.parse(await readFile(
    resolve(projectRoot, 'services/product-video-agent/fixtures/vantrue-t150-operator-script.json'),
    'utf8',
  ));
  const issues = findScriptQualityIssues(content, [], { brand: 'VANTRUE' });

  assert.deepEqual(issues, []);
});

test('script quality checks reject viewer-directed closings and missing punctuation', () => {
  const issues = findScriptQualityIssues({
    hook: 'No more disposable canned air',
    body: 'Three modes direct a reusable air source around a desk.',
    call_to_action: 'Now you can easily clean a keyboard',
  });

  assert.ok(issues.includes('viewer-directed promotional framing'));
  assert.ok(issues.includes('hook must end with sentence punctuation'));
  assert.ok(issues.includes('closing line must end with sentence punctuation'));
});

test('script quality checks reject ad cues and unsupported product outcomes', () => {
  const issues = findScriptQualityIssues({
    hook: 'Dust disappears in seconds.',
    body: 'Watch as it effortlessly tackles tough messes and leaves the desk dust-free.',
    call_to_action: 'An effective cleaning solution that makes the job easier.',
  }, ['instant', 'in seconds', 'dust-free'], { brand: 'Example Labs' });

  assert.ok(issues.includes('promotional adjective or superlative'));
  assert.ok(issues.includes('advertorial benefit framing'));
  assert.ok(issues.includes('advertorial demonstration cue'));
  assert.ok(issues.includes('blocked product claim: in seconds'));
  assert.ok(issues.includes('blocked product claim: dust-free'));
});

test('script quality checks reject inferred performance and charging details', () => {
  const issues = findScriptQualityIssues({
    hook: 'Dust clears instantly.',
    body: 'Its motor speed makes cleaning efficient from a computer or wall adapter.',
    call_to_action: 'The keyboard looks like new.',
  }, ['instant', 'motor speed', 'computer or wall adapter', 'looks like new']);

  assert.ok(issues.includes('promotional adjective or superlative'));
  assert.ok(issues.includes('blocked product claim: instant'));
  assert.ok(issues.includes('blocked product claim: motor speed'));
  assert.ok(issues.includes('blocked product claim: computer or wall adapter'));
  assert.ok(issues.includes('blocked product claim: looks like new'));
});

test('script quality checks reject invented actions and performance outcomes', () => {
  const issues = findScriptQualityIssues({
    hook: 'The speaker splits instantly.',
    body: 'The user blows into it and gets clear audio separation without gaps.',
    call_to_action: 'Both halves work without extra wires.',
  });

  assert.ok(issues.includes('unverified speed or instant-result claim'));
  assert.ok(issues.includes('invented user action'));
  assert.ok(issues.includes('unverified performance outcome'));
  assert.ok(issues.includes('unsupported accessory or setup claim'));
});

test('script quality checks reject audited model inference patterns', () => {
  const issues = findScriptQualityIssues({
    hook: 'Dust disappears.',
    body: 'It is now possible to get immersive sound without being tied down by cables.',
    call_to_action: 'Both halves continue while maintaining connection stability.',
  });

  assert.ok(issues.includes('unverified cleaning outcome'));
  assert.ok(issues.includes('promotional possibility framing'));
  assert.ok(issues.includes('promotional adjective or superlative'));
  assert.ok(issues.includes('unsupported accessory or setup claim'));
  assert.ok(issues.includes('unverified performance outcome'));
});

test('script quality checks reject prompt leakage and generic spoken-ad filler', () => {
  const issues = findScriptQualityIssues({
    hook: 'It unfolds in seconds.',
    body: 'This versatile stand allows you to find optimal positioning without inventing capabilities.',
    call_to_action: 'It is easy to keep ready to go.',
  });

  assert.ok(issues.includes('unverified speed or instant-result claim'));
  assert.ok(issues.includes('generic promotional wording'));
  assert.ok(issues.includes('viewer-directed promotional framing'));
  assert.ok(issues.includes('prompt or restriction leakage'));
});

test('Ollama adapter exhausts eight seeded retries before failing closed', async () => {
  const { config, manifest } = await createDryRun();
  const seeds = [];
  const adapter = new OllamaScriptAdapter(config.script, {
    async fetchImpl(_url, options) {
      seeds.push(JSON.parse(options.body).options.seed);
      return {
        ok: true,
        async json() {
          return {
            response: JSON.stringify({
              hook: 'A rechargeable air stream reaches between keyboard keys.',
              body: 'USB-C charging and three selectable modes support desk cleaning.',
              closing_line: 'An effective cleaning solution.',
            }),
          };
        },
      };
    },
  });

  await assert.rejects(
    adapter.generateVariant({
      product: manifest.products[0],
      scriptJob: manifest.script_jobs[0],
      runAt: manifest.run_at,
    }),
    /failed deterministic quality checks/u,
  );
  assert.deepEqual(seeds, [42, 43, 44, 45, 46, 47, 48, 49]);
});

test('Ollama adapter rejects structured fields that are not strings', async () => {
  const { config, manifest } = await createDryRun();
  const adapter = new OllamaScriptAdapter(config.script, {
    async fetchImpl() {
      return {
        ok: true,
        async json() {
          return {
            response: JSON.stringify({
              hook: 'Valid hook.',
              body: { scene: 'Invalid object body.' },
              call_to_action: 'Valid call to action.',
            }),
          };
        },
      };
    },
  });

  await assert.rejects(
    adapter.generateVariant({
      product: manifest.products[0],
      scriptJob: manifest.script_jobs[0],
      runAt: manifest.run_at,
    }),
    /non-empty string field: body/u,
  );
});

test('runtime doctor distinguishes script readiness from full render readiness', async () => {
  const { config } = await createDryRun();
  const report = await inspectProductVideoRuntime({
    config,
    projectRoot,
    checkedAt: '2026-07-20T00:00:00.000Z',
    ollamaAdapter: {
      async checkReadiness() {
        return { status: 'ready', detail: 'Configured model is local.' };
      },
    },
    async executableCheck(executable) {
      return executable === 'ffmpeg'
        ? { status: 'ready', detail: 'ffmpeg is installed.' }
        : { status: 'blocked', detail: 'local TTS is missing.' };
    },
    async modelFileCheck() {
      return { status: 'blocked', detail: 'Local voice model is missing.' };
    },
  });

  assert.equal(report.script_generation_ready, true);
  assert.equal(report.unattended_script_generation_ready, false);
  assert.equal(report.overall, 'blocked');
  assert.equal(report.components.ollama.status, 'ready');
  assert.equal(report.components.local_tts.status, 'blocked');
});
