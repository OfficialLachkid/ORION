import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';
import {
  applyApprovedItchTheme,
  buildThemeBannerSummary,
  buildThemePrepareCode,
  buildThemePreviewCode,
  buildThemeSaveAndVerifyCode,
  prepareItchThemeCandidate,
} from '../src/itch-theme.mjs';
import { buildItchSlugMigrationCode, migrateItchProjectSlug } from '../src/itch-slug-migrator.mjs';
import {
  buildItchThemeFeedbackModal,
  getItchThemeModalRequest,
  isItchThemeReviewInteraction,
  postItchThemeReview,
  recordItchThemeDecision,
} from '../src/theme-review.mjs';
import {
  contrastRatio,
  OllamaThemeAdapter,
  repairThemeContrast,
} from '../src/ollama-theme-adapter.mjs';

const manifestHash = 'a'.repeat(64);
const listingHash = 'b'.repeat(64);
const design = {
  colors: {
    background: '#080d18',
    panel: '#111a2c',
    text: '#edf6ff',
    link: '#35d9ff',
    header: '#f7f9ff',
    button: '#9d176f',
  },
  panel_alpha: 0.96,
  typography: { body_font: 'Lato', header_font: 'Pixel', size: 'Large' },
  screenshots: 'Sidebar',
  rationale: 'A restrained neon storefront that matches the approved pack palette.',
};

function assertBrowserCodeParses(args) {
  if (args[2] !== 'run-code') return;
  const code = readFileSync(args[4], 'utf8');
  assert.doesNotThrow(() => new Function(`return (${code});`));
}

async function createFixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-theme-'));
  const product = {
    schema_version: '1.0',
    product_id: 'asset-product-test',
    opportunity_id: 'opportunity-test',
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.2.0',
    status: 'approved',
    category: '2D assets',
    product_type: 'weapon sprite pack',
    theme: 'Neon industrial science fiction',
    target_audience: ['indie developers'],
    style: {
      medium: 'pixel art', perspective: 'side-view', width: 128, height: 64,
      max_palette_colors: 32, palette: ['#080d18', '#35d9ff', '#9d176f'],
      outline: 'crisp', lighting: 'neon', background: 'transparent', chroma_key: '#ff00ff',
    },
    assets: [{
      asset_id: 'asset-one', asset_key: 'plasma-pistol', name: 'Plasma Pistol', kind: 'weapon',
      description: 'A plasma pistol.', generation_prompt: 'pixel plasma pistol', seed: 146,
      status: 'generated', source_path: 'assets/source/plasma-pistol.png',
      final_path: 'assets/items/plasma-pistol.png', validation_path: 'validation/plasma-pistol.json',
    }],
    pricing: {
      base_price: { amount: 4.99, currency: 'USD' }, marketplace_prices: { 'itch.io': 4.99 },
      human_approval_required: true,
    },
    distribution: { marketplaces: ['itch.io'], status: 'not_started' },
    license: { status: 'draft', redistribution_of_raw_assets: false },
    generation_provider: { provider: 'ollama', model: 'x/flux2-klein:4b', estimated_cost: 0, execution: 'local' },
    approvals: { generation: 'approved', distribution: 'pending' },
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-16T00:00:00.000Z',
  };
  const productRoot = resolve(outputRoot, product.slug);
  const candidatePath = 'releases/0.2.0/candidates/0123456789abcdef';
  const candidateRoot = resolve(productRoot, candidatePath);
  const listing = {
    listing_hash: listingHash,
    title: product.title,
    short_description: '8 side-view sci-fi weapons with 24 matching effect animations.',
    description: 'Product description',
    suggested_price: { amount: 4.99, currency: 'USD' },
    tags: ['2d'],
    cover_path: 'cover.png',
    screenshot_paths: [],
  };
  const manifest = {
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    target_version: '0.2.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    quality_holds: [],
    gates: { quality_holds_resolved: true },
  };
  await Promise.all([
    mkdir(resolve(candidateRoot, 'download', 'assets', 'individual'), { recursive: true }),
    mkdir(resolve(productRoot, 'review'), { recursive: true }),
  ]);
  await sharp({ create: { width: 128, height: 64, channels: 4, background: '#35d9ff' } })
    .png().toFile(resolve(candidateRoot, 'download', 'assets', 'individual', 'plasma-pistol.png'));
  await Promise.all([
    writeFile(resolve(productRoot, 'product.json'), JSON.stringify(product)),
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify(listing)),
    writeFile(resolve(productRoot, 'releases', '0.2.0', 'latest-candidate.json'), JSON.stringify({
      target_version: '0.2.0', candidate_path: candidatePath, manifest_hash: manifestHash,
    })),
    writeFile(resolve(productRoot, 'review', 'itch.json'), JSON.stringify({
      status: 'verified', manifest_hash: manifestHash, listing_hash: listingHash,
      public_url: 'https://vbjservices.itch.io/asset-pack-test',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/asset-pack-test:assets',
    })),
    writeFile(resolve(productRoot, 'review', 'itch-release.json'), JSON.stringify({
      status: 'verified_public', manifest_hash: manifestHash, listing_hash: listingHash,
      public_url: 'https://vbjservices.itch.io/asset-pack-test',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/asset-pack-test:assets',
    })),
    writeFile(resolve(productRoot, 'review', 'distribution.json'), JSON.stringify({
      status: 'published', manifest_hash: manifestHash, listing_hash: listingHash,
      channel_id: 'channel-1', discord_message_id: 'message-1',
      public_url: 'https://vbjservices.itch.io/asset-pack-test',
      publication: { public_url: 'https://vbjservices.itch.io/asset-pack-test' },
    })),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({
      channel_id: 'channel-1', overview_message_id: 'message-1',
      itch_url: 'https://vbjservices.itch.io/asset-pack-test',
    })),
  ]);
  return {
    outputRoot, productRoot, product, listing, candidateRoot,
    store: { async loadProduct() { return product; }, productRoot() { return productRoot; } },
  };
}

function themeAdapter() {
  return {
    async propose() {
      return {
        design, provider: 'ollama', model: 'llama3.1:8b', execution: 'local', estimated_cost: 0,
        created_at: '2026-10-16T12:00:00.000Z',
      };
    },
  };
}

test('local theme adapter rejects cloud endpoints and enforces readable contrast', async () => {
  assert.throws(() => new OllamaThemeAdapter({ endpoint: 'https://example.com' }), /local Ollama/u);
  assert.ok(contrastRatio(design.colors.text, design.colors.panel) > 4.5);
  const adapter = new OllamaThemeAdapter({
    endpoint: 'http://127.0.0.1:11434',
    fetchImpl: async () => new Response(JSON.stringify({
      created_at: '2026-10-16T12:00:00.000Z',
      message: { content: JSON.stringify(design) },
    }), { status: 200 }),
  });
  const result = await adapter.propose({
    product: { title: 'Neon Plasma Armory', theme: 'Neon sci-fi', product_type: 'pack', style: { palette: ['#35d9ff'] } },
    listing: { short_description: 'A weapon pack.' },
  });
  assert.equal(result.model, 'llama3.1:8b');
  assert.deepEqual(result.design, design);
  assert.equal(result.estimated_cost, 0);
});

test('local theme adapter repairs model-selected contrast without discarding its palette', async () => {
  const inaccessible = {
    ...design,
    colors: { ...design.colors, header: '#17203a', button: '#f2b9dc' },
  };
  const repaired = repairThemeContrast(inaccessible);
  assert.equal(repaired.adjustments.length, 2);
  assert.equal(repaired.adjustments[0].field, 'header');
  assert.equal(repaired.adjustments[1].field, 'button');
  assert.ok(contrastRatio(repaired.design.colors.header, repaired.design.colors.panel) >= 4.5);
  assert.ok(contrastRatio('#ffffff', repaired.design.colors.button) >= 3);
  assert.notEqual(repaired.design.colors.header, '#ffffff');
  assert.notEqual(repaired.design.colors.button, '#000000');
  assert.match(repaired.design.rationale, /adjusted deterministically/u);
});

test('theme banner summary derives product counts and kinds from each release', () => {
  assert.equal(buildThemeBannerSummary({
    assets: [{ kind: 'character' }, { kind: 'character' }, { kind: 'character' }],
  }, {
    asset_count: 3,
    effect_animation_count: 12,
  }), '3 CHARACTERS • 12 MATCHING EFFECTS • TRANSPARENT GAME-READY FILES');
  assert.equal(buildThemeBannerSummary({
    assets: [{ kind: 'tile' }, { kind: 'prop' }],
  }, {
    asset_count: 2,
  }), '2 APPROVED ASSETS • TRANSPARENT GAME-READY FILES');
});

test('browser theme preview passes the dynamic product title into the page context', async () => {
  const code = buildThemePreviewCode({
    design,
    productTitle: 'Crystal Cavern Tiles',
    url: 'https://creator.itch.io/crystal-cavern-tiles',
    bannerDataUrl: 'data:image/png;base64,banner',
    backgroundDataUrl: 'data:image/png;base64,background',
    desktopPath: '/tmp/desktop.png',
    mobilePath: '/tmp/mobile.png',
  });
  const preview = new Function(`return (${code});`)();
  let evaluateInput = null;
  const wrapper = { async screenshot() {} };
  await preview({
    async goto() {},
    async waitForTimeout() {},
    url() { return 'https://creator.itch.io/crystal-cavern-tiles'; },
    locator(selector) {
      if (selector === 'body') return { async innerText() { return ''; } };
      return { first() { return wrapper; } };
    },
    async addStyleTag() {},
    async evaluate(_callback, input) { evaluateInput = input; },
    async setViewportSize() {},
  });
  assert.equal(evaluateInput.productTitle, 'Crystal Cavern Tiles');
  assert.equal(evaluateInput.bannerDataUrl, 'data:image/png;base64,banner');
});

test('theme apply waits for the save request and verifies approved panel alpha', () => {
  const code = buildThemeSaveAndVerifyCode({
    design,
    url: 'https://creator.itch.io/example',
    desktopPath: '/tmp/desktop.png',
    mobilePath: '/tmp/mobile.png',
  });
  assert.doesNotThrow(() => new Function(`return (${code});`));
  assert.match(code, /response\.url\(\)\.endsWith\('\/edit'\)/u);
  assert.match(code, /panel_alpha/u);
  assert.match(code, /#wrapper, \.wrapper/u);
  assert.match(code, /wrapper\.waitFor/u);
  assert.match(code, /networkidle/u);
  assert.match(code, /attempt < 40/u);
  assert.match(code, /waitForTimeout\(250\)/u);
  assert.match(code, /fullPage: true/u);
});

test('theme editor preparation restores a desktop viewport before checking responsive controls', () => {
  const code = buildThemePrepareCode({
    design,
    url: 'https://creator.itch.io/example',
  });
  assert.doesNotThrow(() => new Function(`return (${code});`));
  assert.match(code, /setViewportSize\(\{ width: 1440, height: 1000 \}\)/u);
  assert.ok(code.indexOf('setViewportSize') < code.indexOf('page.goto'));
});

test('theme candidate renders deterministic media and creates desktop/mobile previews without saving', async () => {
  const fixture = await createFixture();
  const commands = [];
  const cliRunner = (_executable, args) => {
    commands.push(args[2]);
    assertBrowserCodeParses(args);
    if (args[2] === 'run-code') return { ok: true, stdout: JSON.stringify({ result: JSON.stringify({ status: 'previewed' }) }) };
    return { ok: true, stdout: '{}' };
  };
  const result = await prepareItchThemeCandidate({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    themeAdapter: themeAdapter(),
    cliRunner,
    headed: false,
    now: '2026-10-16T12:00:00.000Z',
  });
  assert.equal(result.status, 'previewed');
  assert.match(result.theme_hash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(commands, ['open', 'run-code', 'close']);
  for (const name of ['banner.png', 'background.png', 'theme.json']) {
    assert.ok((await readFile(resolve(result.candidateRoot, name))).length > 0);
  }
});

test('theme approval is persisted before the exact candidate may be applied', async () => {
  const fixture = await createFixture();
  const candidate = await prepareItchThemeCandidate({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    themeAdapter: themeAdapter(),
    cliRunner(_executable, args) {
      assertBrowserCodeParses(args);
      if (args[2] === 'run-code') return { ok: true, stdout: JSON.stringify({ result: JSON.stringify({ status: 'previewed' }) }) };
      return { ok: true, stdout: '{}' };
    },
    headed: false,
  });
  await Promise.all([
    sharp({ create: { width: 1440, height: 1000, channels: 3, background: '#080d18' } })
      .png().toFile(resolve(candidate.candidateRoot, candidate.media.desktop_preview_path)),
    sharp({ create: { width: 390, height: 844, channels: 3, background: '#080d18' } })
      .png().toFile(resolve(candidate.candidateRoot, candidate.media.mobile_preview_path)),
  ]);
  const posted = await postItchThemeReview({
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    candidate,
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' } },
    fetchImpl: async () => new Response(JSON.stringify({ id: 'theme-message-1' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  });
  assert.equal(posted.status, 'awaiting_approval');
  const customId = `dat|a|${fixture.product.slug}|${candidate.theme_hash.slice(0, 16)}`;
  const interaction = {
    type: 3,
    id: 'interaction-1',
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    message: { id: 'theme-message-1' },
    data: { custom_id: customId },
    member: { user: { id: 'operator-1', username: 'operator' }, roles: [] },
  };
  const recorded = await recordItchThemeDecision({
    interaction,
    config: {
      guildId: 'guild-1', operatorUserIds: ['operator-1'], operatorRoleId: '',
      env: {
        DIGITAL_ASSET_ARCHIVE_ROOT: fixture.outputRoot,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'service-key',
      },
    },
    fetchImpl: async () => new Response('[]', { status: 201 }),
  });
  assert.equal(recorded.state.status, 'approved');
  assert.equal(recorded.row.theme_hash, candidate.theme_hash);

  const cliRunner = (_executable, args) => {
    assertBrowserCodeParses(args);
    if (args[2] === 'run-code') {
      const file = basename(args[4]);
      const status = file === 'verify-live.js' ? 'verification_failed'
        : file === 'prepare.js' ? 'prepared'
          : file.startsWith('upload-') ? 'chooser_opened'
            : file.startsWith('ready-') ? 'image_ready'
              : 'verified_applied';
      const details = status === 'verified_applied'
        ? { status, checks: { background: true, background_image: true, panel: true, panel_alpha: true, text: true, header: true, button: true, banner: true } }
        : status === 'image_ready' ? { status, count: 2 } : { status };
      return { ok: true, stdout: JSON.stringify({ result: JSON.stringify(details) }) };
    }
    return { ok: true, stdout: '{}' };
  };
  const applied = await applyApprovedItchTheme({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    cliRunner,
    headed: false,
    now: '2026-10-16T13:00:00.000Z',
  });
  assert.equal(applied.status, 'verified_applied');
  const state = JSON.parse(await readFile(resolve(fixture.productRoot, 'review', 'itch-theme.json'), 'utf8'));
  assert.equal(state.status, 'applied');
});

test('request changes opens a feedback modal and only the modal submission is recordable', () => {
  const interaction = {
    type: 3,
    data: { custom_id: `dat|r|neon-plasma-armory|${'a'.repeat(16)}` },
  };
  const request = getItchThemeModalRequest(interaction);
  assert.equal(request.action, 'r');
  const modal = buildItchThemeFeedbackModal(request);
  assert.match(modal.custom_id, /dat\|m\|neon-plasma-armory/u);
  assert.equal(isItchThemeReviewInteraction(interaction), false);
  assert.equal(isItchThemeReviewInteraction({ type: 5, data: { custom_id: modal.custom_id } }), true);
});

test('slug migration preserves the ORION title and reconciles marketplace URLs and Butler target', async () => {
  const fixture = await createFixture();
  const result = await migrateItchProjectSlug({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    targetSlug: 'neon-plasma-armory',
    headed: false,
    cliRunner(_executable, args) {
      assertBrowserCodeParses(args);
      if (args[2] === 'run-code') {
        return { ok: true, stdout: JSON.stringify({ result: JSON.stringify({ status: 'migrated', previousSlug: 'asset-pack-test' }) }) };
      }
      return { ok: true, stdout: '{}' };
    },
    publicFetchImpl: async () => new Response('<title>Neon Plasma Armory by VBJServices</title>', { status: 200 }),
    now: '2026-10-16T14:00:00.000Z',
  });
  assert.equal(result.target_url, 'https://vbjservices.itch.io/neon-plasma-armory');
  assert.equal(result.previous_butler_target, 'vbjservices/asset-pack-test:assets');
  assert.equal(result.butler_target, 'vbjservices/neon-plasma-armory:assets');
  assert.equal(result.download_display_name, 'neon-plasma-armory-assets.zip');
  const release = JSON.parse(await readFile(resolve(fixture.productRoot, 'review', 'itch-release.json'), 'utf8'));
  assert.equal(release.public_url, result.target_url);
  assert.equal(release.butler_target, result.butler_target);
});

test('slug migration browser step renames only the production Butler upload', () => {
  const code = buildItchSlugMigrationCode({
    editUrl: 'https://itch.io/game/edit/5144533',
    expectedTitle: 'Neon Plasma Armory',
    targetSlug: 'neon-plasma-armory',
  });
  assert.match(code, /input\.targetSlug \+ '-assets\.zip'/u);
  assert.match(code, /assets-preview\$\/iu/u);
  assert.match(code, /change display name/i);
  assert.match(code, /production_upload_missing/u);
  assert.doesNotThrow(() => new Function(`return (${code})`));
});
