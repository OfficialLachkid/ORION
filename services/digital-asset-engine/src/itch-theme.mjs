import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { CanonicalProductStore } from './canonical-store.mjs';
import { OllamaThemeAdapter } from './ollama-theme-adapter.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

const RENDERER_VERSION = '1.0.0';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileHash(path) {
  return sha256(await readFile(path));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function expandHomeDirectory(path) {
  const value = String(path || '').trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return resolve(os.homedir(), value.slice(2));
  return resolve(value);
}

function cleanPublicUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.itch.io')) {
    throw new Error('Theme staging requires an https://*.itch.io public URL.');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

function defaultCliRunner(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: Number(options.timeoutMs) || 60_000,
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : '',
  };
}

function parseCliJson(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    return typeof parsed?.result === 'string' ? JSON.parse(parsed.result) : parsed;
  } catch {
    return null;
  }
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildThemeBannerSummary(product, manifest) {
  const assetCount = Number(manifest?.asset_count) || product.assets.length;
  const kinds = [...new Set(product.assets.map((asset) => String(asset.kind || '').trim().toLowerCase()).filter(Boolean))];
  const assetLabel = kinds.length === 1
    ? `${assetCount} ${kinds[0].toUpperCase()}${assetCount === 1 ? '' : 'S'}`
    : `${assetCount} APPROVED ASSETS`;
  const effectCount = Number(manifest?.effect_animation_count) || 0;
  return [
    assetLabel,
    ...(effectCount ? [`${effectCount} MATCHING EFFECTS`] : []),
    'TRANSPARENT GAME-READY FILES',
  ].join(' • ');
}

async function renderThemeMedia({ candidateRoot, packagedRoot, product, manifest, design }) {
  const width = 960;
  const bannerHeight = 240;
  const weaponFiles = await Promise.all(product.assets.map(async (asset) => ({
    asset,
    buffer: await readFile(resolve(
      packagedRoot,
      'download',
      'assets',
      'individual',
      basename(asset.final_path),
    )),
  })));
  const cells = weaponFiles.map(({ asset }, index) => {
    const x = 28 + ((index % 4) * 232);
    const y = 103 + (Math.floor(index / 4) * 62);
    return [
      `<rect x="${x}" y="${y}" width="218" height="54" rx="8" fill="${design.colors.panel}" stroke="${design.colors.link}" stroke-opacity="0.35"/>`,
      `<text x="${x + 109}" y="${y + 48}" text-anchor="middle" fill="${design.colors.text}" font-family="Arial, sans-serif" font-size="10" font-weight="700">${escapeXml(asset.name)}</text>`,
    ].join('');
  }).join('');
  const composites = await Promise.all(weaponFiles.map(async ({ buffer }, index) => ({
    input: await sharp(buffer).resize(148, 42, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toBuffer(),
    left: 63 + ((index % 4) * 232),
    top: 107 + (Math.floor(index / 4) * 62),
  })));
  const bannerSvg = Buffer.from([
    `<svg width="${width}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="100%" height="100%" fill="${design.colors.background}"/>`,
    `<rect x="18" y="18" width="924" height="70" rx="14" fill="${design.colors.panel}" stroke="${design.colors.link}" stroke-width="2"/>`,
    `<rect x="34" y="31" width="8" height="44" rx="4" fill="${design.colors.button}"/>`,
    `<text x="480" y="53" text-anchor="middle" fill="${design.colors.header}" stroke="${design.colors.background}" stroke-width="4" paint-order="stroke" font-family="Arial, sans-serif" font-size="34" font-weight="900">${escapeXml(product.title.toUpperCase())}</text>`,
    `<text x="480" y="76" text-anchor="middle" fill="${design.colors.link}" font-family="Arial, sans-serif" font-size="13" font-weight="800">${escapeXml(buildThemeBannerSummary(product, manifest))}</text>`,
    cells,
    '</svg>',
  ].join(''));
  const watermarkSvg = Buffer.from([
    `<svg width="${width}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">`,
    weaponFiles.map((_, index) => {
      const x = 137 + ((index % 4) * 232);
      const y = 135 + (Math.floor(index / 4) * 62);
      return `<text x="${x}" y="${y}" text-anchor="middle" fill="#ffffff" fill-opacity="0.3" stroke="${design.colors.background}" stroke-opacity="0.8" font-family="Arial, sans-serif" font-size="12" font-weight="800" transform="rotate(-12 ${x} ${y})">PREVIEW</text>`;
    }).join(''),
    '</svg>',
  ].join(''));
  const bannerPath = resolve(candidateRoot, 'banner.png');
  await sharp({ create: { width, height: bannerHeight, channels: 3, background: design.colors.background } })
    .composite([{ input: bannerSvg }, ...composites, { input: watermarkSvg }])
    .png({ compressionLevel: 9 })
    .toFile(bannerPath);

  const backgroundSvg = Buffer.from([
    '<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">',
    '<defs>',
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${design.colors.background}"/><stop offset="1" stop-color="${design.colors.panel}"/></linearGradient>`,
    `<pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="${design.colors.link}" stroke-opacity="0.08" stroke-width="1"/></pattern>`,
    '</defs>',
    '<rect width="100%" height="100%" fill="url(#g)"/>',
    '<rect width="100%" height="100%" fill="url(#grid)"/>',
    `<circle cx="250" cy="180" r="2" fill="${design.colors.link}" fill-opacity="0.45"/><circle cx="1650" cy="260" r="2" fill="${design.colors.header}" fill-opacity="0.32"/>`,
    `<path d="M0 880 L530 350 L890 710 L1400 190 L1920 710" fill="none" stroke="${design.colors.button}" stroke-opacity="0.08" stroke-width="3"/>`,
    '</svg>',
  ].join(''));
  const backgroundPath = resolve(candidateRoot, 'background.png');
  await sharp(backgroundSvg).png({ compressionLevel: 9 }).toFile(backgroundPath);
  return { bannerPath, backgroundPath };
}

export function buildThemePreviewCode(input) {
  return `
async (page) => {
  const input = ${JSON.stringify(input)};
  const font = (value) => value === 'Pixel' ? 'monospace' : value === 'Sans Serif' ? 'Arial, sans-serif' : value;
  const hex = (value, alpha = 1) => {
    const parts = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
    return \`rgba(\${parts.join(', ')}, \${alpha})\`;
  };
  await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  if (page.url().includes('/login') || /page is currently in draft|page not found/i.test(await page.locator('body').innerText().catch(() => ''))) {
    return { status: 'public_page_unavailable', url: page.url() };
  }
  await page.addStyleTag({ content: \`
    #wrapper { background-color: \${input.design.colors.background} !important; background-image: url(\${input.backgroundDataUrl}) !important; background-size: cover !important; background-attachment: fixed !important; }
    #inner_column { background-color: \${hex(input.design.colors.panel, input.design.panel_alpha)} !important; color: \${input.design.colors.text} !important; font-family: \${font(input.design.typography.body_font)} !important; }
    #inner_column h1, #inner_column h2, #inner_column h3 { color: \${input.design.colors.header} !important; font-family: \${font(input.design.typography.header_font)} !important; }
    #inner_column a { color: \${input.design.colors.link} !important; }
    #inner_column .button { background: \${input.design.colors.button} !important; color: #fff !important; }
  \` });
  await page.evaluate(({ bannerDataUrl, productTitle }) => {
    const header = document.querySelector('#header, .header');
    if (!header) return;
    const heading = header.querySelector('h1');
    if (heading) heading.style.display = 'none';
    const image = document.createElement('img');
    image.id = 'orion-theme-preview-banner';
    image.src = bannerDataUrl;
    image.alt = productTitle + ' storefront banner preview';
    image.style.width = '100%';
    image.style.height = 'auto';
    image.style.display = 'block';
    header.prepend(image);
  }, { bannerDataUrl: input.bannerDataUrl, productTitle: input.productTitle });
  const wrapper = page.locator('#wrapper, .wrapper').first();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await wrapper.screenshot({ path: input.desktopPath });
  await page.setViewportSize({ width: 390, height: 844 });
  await wrapper.screenshot({ path: input.mobilePath });
  return { status: 'previewed', url: page.url(), desktop: input.desktopPath, mobile: input.mobilePath };
}`.trim();
}

export function buildThemePrepareCode({ design, url }) {
  return `
async (page) => {
  const input = ${JSON.stringify({ design, url })};
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('button')]
    .some((button) => /edit theme/i.test(button.textContent || '')), null, { timeout: 30000 }).catch(() => {});
  const edit = page.getByRole('button', { name: /edit theme/i }).first();
  if (!(await edit.count().catch(() => 0)) || !(await edit.isVisible().catch(() => false))) {
    return {
      status: 'theme_editor_unavailable',
      url: page.url(),
      title: await page.title().catch(() => ''),
      buttons: await page.locator('button').allTextContents().catch(() => []),
    };
  }
  await edit.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  const more = page.getByRole('button', { name: /more options/i });
  const count = await more.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (await more.nth(index).isVisible().catch(() => false)) await more.nth(index).click().catch(() => {});
  }
  const fill = async (name, value) => {
    const field = page.getByRole('textbox', { name, exact: true }).first();
    if (!(await field.count().catch(() => 0))) return false;
    await field.fill(value);
    await field.press('Tab').catch(() => {});
    return true;
  };
  const colors = input.design.colors;
  const colorChecks = await Promise.all([
    fill('BG', colors.background), fill('BG 2', colors.panel), fill('Text', colors.text),
    fill('Link', colors.link), fill('Headers', colors.header), fill('Buttons', colors.button),
  ]);
  const selects = {
    body: page.getByRole('combobox', { name: /^Font /i }).first(),
    header: page.getByRole('combobox', { name: /^Header font /i }).first(),
    size: page.getByRole('combobox', { name: /^Size /i }).first(),
    screenshots: page.getByRole('combobox', { name: /^Screenshots /i }).first(),
  };
  await selects.body.selectOption({ label: input.design.typography.body_font });
  await selects.header.selectOption({ label: input.design.typography.header_font });
  await selects.size.selectOption({ label: input.design.typography.size });
  await selects.screenshots.selectOption({ label: input.design.screenshots });
  const alphaTarget = Math.round(input.design.panel_alpha * 100);
  const alphaButton = page.getByRole('button', { name: /^BG2 Alpha(?: \d+)?$/i }).first();
  let alpha = { found: false, value: null };
  if (await alphaButton.count().catch(() => 0)) {
    await alphaButton.click();
    for (let attempts = 0; attempts <= 100; attempts += 1) {
      const current = await alphaButton.evaluate((node) => {
        const source = [node.getAttribute('aria-valuenow'), node.getAttribute('aria-label'), node.parentElement?.textContent]
          .filter(Boolean).join(' ');
        const matches = source.match(/\d+(?:\.\d+)?/g);
        return matches?.length ? Number(matches[matches.length - 1]) : null;
      }).catch(() => null);
      if (current === alphaTarget) {
        alpha = { found: true, value: current };
        break;
      }
      if (!Number.isFinite(current)) break;
      await alphaButton.press(current > alphaTarget ? 'ArrowLeft' : 'ArrowRight');
    }
  }
  return {
    status: colorChecks.every(Boolean) && alpha.found ? 'prepared' : 'controls_missing',
    colorChecks,
    alpha,
    url: page.url(),
  };
}`.trim();
}

function buildThemeImageTriggerCode(kind) {
  return `
async (page) => {
  const button = page.getByRole('button', { name: ${JSON.stringify(kind)}, exact: true }).first();
  if (!(await button.count().catch(() => 0))) return { status: 'button_missing', kind: ${JSON.stringify(kind)} };
  await button.click({ timeout: 5000 });
  return { status: 'chooser_opened', kind: ${JSON.stringify(kind)} };
}`.trim();
}

function buildThemeImageReadyCode(expectedCount) {
  return `
async (page) => {
  const expectedCount = ${Number(expectedCount)};
  const removeButtons = page.getByRole('button', { name: /remove image/i });
  for (let attempts = 0; attempts < 60; attempts += 1) {
    const count = await removeButtons.count().catch(() => 0);
    if (count >= expectedCount) return { status: 'image_ready', count };
    await page.waitForTimeout(250);
  }
  return { status: 'image_not_ready', count: await removeButtons.count().catch(() => 0) };
}`.trim();
}

export function buildThemeSaveAndVerifyCode(input) {
  return `
async (page) => {
  const input = ${JSON.stringify(input)};
  if (!input.skipSave) {
    const save = page.getByRole('button', { name: /^save$/i }).first();
    if (!(await save.count().catch(() => 0))) return { status: 'save_missing' };
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && response.url().endsWith('/edit'), { timeout: 15000 }).catch(() => null);
    await save.click({ timeout: 5000 });
    const response = await responsePromise;
    if (!response || !response.ok()) return { status: 'save_failed', httpStatus: response?.status?.() || null };
    await page.waitForTimeout(1000);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const wrapper = page.locator('#wrapper, .wrapper').first();
  await wrapper.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ');
  const hasRgb = (actual, expected) => actual.includes(rgb(expected));
  const readStyles = () => page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };
    const wrapperStyle = read('#wrapper, .wrapper');
    const innerStyle = read('#inner_column, .inner_column');
    const headingStyle = read('#inner_column h2, .inner_column h2');
    const buttonStyle = read('#inner_column .button, .inner_column .button');
    return {
      background: wrapperStyle?.backgroundColor || '',
      backgroundImage: wrapperStyle?.backgroundImage || '',
      panel: innerStyle?.backgroundColor || '',
      text: innerStyle?.color || '',
      font: innerStyle?.fontFamily || '',
      header: headingStyle?.color || '',
      headerFont: headingStyle?.fontFamily || '',
      button: buttonStyle?.backgroundColor || '',
      banner: Boolean(document.querySelector('#header img, .header img')),
    };
  });
  const assess = (styles) => {
    const panelAlphaMatch = styles.panel.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/i);
    const actualPanelAlpha = panelAlphaMatch?.[1] === undefined ? 1 : Number(panelAlphaMatch[1]);
    return {
      background: hasRgb(styles.background, input.design.colors.background),
      background_image: styles.backgroundImage !== 'none',
      panel: hasRgb(styles.panel, input.design.colors.panel),
      panel_alpha: Math.abs(actualPanelAlpha - input.design.panel_alpha) <= 0.01,
      text: hasRgb(styles.text, input.design.colors.text),
      header: hasRgb(styles.header, input.design.colors.header),
      button: hasRgb(styles.button, input.design.colors.button),
      banner: styles.banner,
    };
  };
  let styles = await readStyles();
  let checks = assess(styles);
  for (let attempt = 0; attempt < 40 && !Object.values(checks).every(Boolean); attempt += 1) {
    await page.waitForTimeout(250);
    styles = await readStyles();
    checks = assess(styles);
  }
  if (await wrapper.count().catch(() => 0)) await wrapper.screenshot({ path: input.desktopPath });
  else await page.screenshot({ path: input.desktopPath, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await wrapper.count().catch(() => 0)) await wrapper.screenshot({ path: input.mobilePath });
  else await page.screenshot({ path: input.mobilePath, fullPage: true });
  return {
    status: Object.values(checks).every(Boolean) ? 'verified_applied' : 'verification_failed',
    checks,
    styles,
    url: page.url(),
    title: await page.title().catch(() => ''),
  };
}`.trim();
}

function buildThemeVerifyCode(input) {
  return buildThemeSaveAndVerifyCode({ ...input, skipSave: true });
}

function openBrowser({ executable, sessionName, profileDir, url, headed, cliRunner, cwd, env }) {
  const args = ['-s', sessionName, 'open', url, '--browser', 'chrome', '--persistent', '--profile', profileDir, '--json'];
  if (headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') args.splice(-1, 0, '--headed');
  const opened = cliRunner(executable, args, { cwd, env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open itch.io theme browser: ${opened.stderr || opened.stdout || opened.error}`);
}

function runBrowserCode({ executable, sessionName, cliRunner, cwd, env, codeRoot, filename, code }) {
  const path = resolve(codeRoot, filename);
  writeFileSync(path, code, 'utf8');
  const result = cliRunner(executable, ['-s', sessionName, 'run-code', '--filename', path, '--json'], {
    cwd,
    env,
    timeoutMs: 3 * 60_000,
  });
  if (!result.ok) throw new Error(`itch.io theme browser failed: ${result.stderr || result.stdout || result.error}`);
  const details = parseCliJson(result.stdout) || {};
  if (details.isError) throw new Error(`itch.io theme browser failed: ${details.error}`);
  return details;
}

async function releaseContext(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({ productRoot, releaseVersion: options.releaseVersion });
  const [release, itch] = await Promise.all([
    readJson(resolve(productRoot, 'review', 'itch-release.json')),
    readJson(resolve(productRoot, 'review', 'itch.json')),
  ]);
  if (release.status !== 'verified_public'
    || release.manifest_hash !== packaged.manifest.manifest_hash
    || release.listing_hash !== packaged.manifest.listing_hash) {
    throw new Error('Theme work requires the exact verified public release.');
  }
  return { store, product, productRoot, packaged, release, itch };
}

export async function prepareItchThemeCandidate(options) {
  const context = await releaseContext(options);
  const { product, productRoot, packaged, release } = context;
  const adapter = options.themeAdapter || new OllamaThemeAdapter({
    endpoint: options.ollamaEndpoint || process.env.OLLAMA_URL,
    model: options.themeModel || process.env.DIGITAL_ASSET_THEME_MODEL || 'llama3.1:8b',
    timeoutMs: options.themeTimeoutMs,
    fetchImpl: options.ollamaFetchImpl,
  });
  const proposal = await adapter.propose({ product, listing: packaged.listing });
  const createdAt = options.now || proposal.created_at || new Date().toISOString();
  const identity = {
    schema_version: '1.0',
    product_id: product.product_id,
    product_slug: product.slug,
    product_title: product.title,
    target_version: packaged.manifest.target_version || product.version,
    manifest_hash: packaged.manifest.manifest_hash,
    listing_hash: packaged.manifest.listing_hash,
    renderer_version: RENDERER_VERSION,
    generator: {
      provider: proposal.provider,
      model: proposal.model,
      execution: proposal.execution,
      estimated_cost: proposal.estimated_cost,
      contrast_adjustments: proposal.contrast_adjustments || [],
    },
    design: proposal.design,
  };
  const themeHash = sha256(JSON.stringify(identity));
  const candidateRoot = resolve(productRoot, 'review', 'theme', 'candidates', themeHash.slice(0, 16));
  const themePath = resolve(candidateRoot, 'theme.json');
  const previous = await readOptionalJson(themePath);
  if (previous?.theme_hash === themeHash) {
    return { ...previous, candidateRoot, themePath, reused: true };
  }
  await mkdir(candidateRoot, { recursive: true });
  const { bannerPath, backgroundPath } = await renderThemeMedia({
    candidateRoot,
    packagedRoot: packaged.root,
    product,
    manifest: packaged.manifest,
    design: proposal.design,
  });
  const previewDesktopPath = resolve(candidateRoot, 'preview-desktop.png');
  const previewMobilePath = resolve(candidateRoot, 'preview-mobile.png');
  const env = options.env || process.env;
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const cliRunner = options.cliRunner || defaultCliRunner;
  const sessionName = options.sessionName || `orion-itch-theme-preview-${product.slug}`;
  const profileDir = expandHomeDirectory(options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch');
  const codeRoot = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-theme-preview-'));
  openBrowser({
    executable, sessionName, profileDir, url: release.public_url, headed: options.headed,
    cliRunner, cwd: options.cwd, env,
  });
  try {
    const details = runBrowserCode({
      executable,
      sessionName,
      cliRunner,
      cwd: options.cwd,
      env,
      codeRoot,
      filename: 'preview.js',
      code: buildThemePreviewCode({
        design: proposal.design,
        productTitle: product.title,
        url: cleanPublicUrl(release.public_url),
        bannerDataUrl: `data:image/png;base64,${(await readFile(bannerPath)).toString('base64')}`,
        backgroundDataUrl: `data:image/png;base64,${(await readFile(backgroundPath)).toString('base64')}`,
        desktopPath: previewDesktopPath,
        mobilePath: previewMobilePath,
      }),
    });
    if (details.status !== 'previewed') throw new Error(`Theme preview failed: ${JSON.stringify(details)}`);
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close', '--json'], { cwd: options.cwd, env, timeoutMs: 15_000 });
    rmSync(codeRoot, { recursive: true, force: true });
  }
  const state = {
    ...identity,
    theme_hash: themeHash,
    status: 'previewed',
    public_url: cleanPublicUrl(release.public_url),
    candidate_path: relative(productRoot, candidateRoot).replaceAll('\\', '/'),
    media: {
      banner_path: relative(candidateRoot, bannerPath).replaceAll('\\', '/'),
      banner_hash: await fileHash(bannerPath),
      background_path: relative(candidateRoot, backgroundPath).replaceAll('\\', '/'),
      background_hash: await fileHash(backgroundPath),
      desktop_preview_path: relative(candidateRoot, previewDesktopPath).replaceAll('\\', '/'),
      mobile_preview_path: relative(candidateRoot, previewMobilePath).replaceAll('\\', '/'),
    },
    created_at: createdAt,
  };
  await writeFile(themePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { ...state, candidateRoot, themePath, reused: false };
}

export async function applyApprovedItchTheme(options) {
  const context = await releaseContext(options);
  const { product, productRoot, packaged, release } = context;
  const statePath = resolve(productRoot, 'review', 'itch-theme.json');
  const themeState = await readJson(statePath);
  if (themeState.status !== 'approved'
    || themeState.last_decision?.decision !== 'approve'
    || themeState.manifest_hash !== packaged.manifest.manifest_hash
    || themeState.listing_hash !== packaged.manifest.listing_hash) {
    throw new Error('Applying an itch.io theme requires approval for the exact public release and theme hash.');
  }
  const receiptPath = resolve(productRoot, 'review', 'itch-theme-release.json');
  const previous = await readOptionalJson(receiptPath);
  if (previous?.status === 'verified_applied' && previous.theme_hash === themeState.theme_hash) {
    return { ...previous, statePath: receiptPath, themeStatePath: statePath, reused: true };
  }
  const candidateRoot = resolve(productRoot, themeState.candidate_path);
  const bannerPath = resolve(candidateRoot, themeState.media.banner_path);
  const backgroundPath = resolve(candidateRoot, themeState.media.background_path);
  if (!existsSync(bannerPath) || !existsSync(backgroundPath)) throw new Error('Approved theme media is missing.');
  if (await fileHash(bannerPath) !== themeState.media.banner_hash
    || await fileHash(backgroundPath) !== themeState.media.background_hash) {
    throw new Error('Approved theme media hashes no longer match.');
  }
  const appliedDesktopPath = resolve(candidateRoot, 'applied-desktop.png');
  const appliedMobilePath = resolve(candidateRoot, 'applied-mobile.png');
  const env = options.env || process.env;
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const cliRunner = options.cliRunner || defaultCliRunner;
  const sessionName = options.sessionName || `orion-itch-theme-apply-${product.slug}`;
  const profileDir = expandHomeDirectory(options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch');
  const codeRoot = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-theme-apply-'));
  openBrowser({
    executable, sessionName, profileDir, url: release.public_url, headed: options.headed,
    cliRunner, cwd: options.cwd, env,
  });
  try {
    const verificationInput = {
      design: themeState.design,
      url: cleanPublicUrl(release.public_url),
      desktopPath: appliedDesktopPath,
      mobilePath: appliedMobilePath,
    };
    let details = runBrowserCode({
      executable, sessionName, cliRunner, cwd: options.cwd, env, codeRoot,
      filename: 'verify-live.js',
      code: buildThemeVerifyCode(verificationInput),
    });
    const recoveredExistingTheme = details.status === 'verified_applied';
    if (!recoveredExistingTheme) {
      const prepared = runBrowserCode({
        executable, sessionName, cliRunner, cwd: options.cwd, env, codeRoot,
        filename: 'prepare.js',
        code: buildThemePrepareCode({ design: themeState.design, url: cleanPublicUrl(release.public_url) }),
      });
      if (prepared.status !== 'prepared') {
        throw new Error(`Theme editor preparation failed: ${JSON.stringify({ verification: details, preparation: prepared })}`);
      }
      let expectedImageCount = 0;
      for (const [kind, path] of [['Banner', bannerPath], ['Background', backgroundPath]]) {
        const triggered = runBrowserCode({
          executable, sessionName, cliRunner, cwd: options.cwd, env, codeRoot,
          filename: `upload-${kind.toLowerCase()}.js`,
          code: buildThemeImageTriggerCode(kind),
        });
        if (triggered.status !== 'chooser_opened') throw new Error(`Theme ${kind} chooser failed.`);
        const uploaded = cliRunner(executable, ['-s', sessionName, 'upload', path, '--json'], {
          cwd: options.cwd,
          env,
          timeoutMs: 3 * 60_000,
        });
        if (!uploaded.ok || parseCliJson(uploaded.stdout)?.isError) {
          throw new Error(`Theme ${kind} upload failed: ${uploaded.stderr || uploaded.stdout || uploaded.error}`);
        }
        expectedImageCount += 1;
        const ready = runBrowserCode({
          executable, sessionName, cliRunner, cwd: options.cwd, env, codeRoot,
          filename: `ready-${kind.toLowerCase()}.js`,
          code: buildThemeImageReadyCode(expectedImageCount),
        });
        if (ready.status !== 'image_ready') throw new Error(`Theme ${kind} upload did not settle: ${JSON.stringify(ready)}`);
      }
      details = runBrowserCode({
        executable, sessionName, cliRunner, cwd: options.cwd, env, codeRoot,
        filename: 'save-verify.js',
        code: buildThemeSaveAndVerifyCode(verificationInput),
      });
      if (details.status !== 'verified_applied') {
        throw new Error(`Applied theme verification failed: ${JSON.stringify(details)}`);
      }
    }
    const appliedAt = options.now || new Date().toISOString();
    const receipt = {
      schema_version: '1.0',
      status: 'verified_applied',
      product_id: product.product_id,
      product_slug: product.slug,
      target_version: packaged.manifest.target_version || product.version,
      manifest_hash: packaged.manifest.manifest_hash,
      listing_hash: packaged.manifest.listing_hash,
      theme_hash: themeState.theme_hash,
      public_url: cleanPublicUrl(release.public_url),
      applied_at: appliedAt,
      verified_at: appliedAt,
      recovered_existing_theme: recoveredExistingTheme,
      verification: details.checks,
      desktop_screenshot_path: appliedDesktopPath,
      mobile_screenshot_path: appliedMobilePath,
    };
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    themeState.status = 'applied';
    themeState.application = {
      applied_at: appliedAt,
      verified_at: appliedAt,
      receipt_path: 'review/itch-theme-release.json',
    };
    await writeFile(statePath, `${JSON.stringify(themeState, null, 2)}\n`, 'utf8');
    return { ...receipt, statePath: receiptPath, themeStatePath: statePath, reused: false };
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close', '--json'], { cwd: options.cwd, env, timeoutMs: 15_000 });
    rmSync(codeRoot, { recursive: true, force: true });
  }
}
