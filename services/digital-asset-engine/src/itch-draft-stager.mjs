import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';

function readJson(path) {
  return readFile(path, 'utf8').then((value) => JSON.parse(value));
}

function normalizeItchUrl(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.itch.io')) {
    throw new Error('The itch.io draft URL must be an https://*.itch.io URL.');
  }
  if (parsed.username || parsed.password) throw new Error('The itch.io URL cannot contain credentials.');
  return parsed;
}

function butlerTargetFromUrl(value) {
  const url = normalizeItchUrl(value);
  const account = url.hostname.slice(0, -'.itch.io'.length);
  const slug = url.pathname.split('/').filter(Boolean)[0];
  if (!account || !slug || !/^[a-z0-9-]+$/u.test(account) || !/^[a-z0-9-]+$/u.test(slug)) {
    throw new Error('Could not derive the itch.io account and project slug from the draft URL.');
  }
  return `${account}/${slug}`;
}

function expandHomeDirectory(path) {
  const value = String(path || '').trim();
  if (!value) return '';
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return resolve(os.homedir(), value.slice(2));
  return resolve(value);
}

function runnerResult(executable, args, result) {
  return {
    executable,
    args,
    ok: result.status === 0 && !result.error,
    exitCode: result.status ?? null,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : '',
  };
}

function defaultCliRunner(executable, args, options = {}) {
  return runnerResult(executable, args, spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: Number(options.timeoutMs) || 60_000,
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  }));
}

function parseCliJson(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    return typeof parsed?.result === 'string' ? JSON.parse(parsed.result) : parsed;
  } catch {
    return null;
  }
}

export function buildItchDraftRunCode({ listing, publicUrl, editUrl }) {
  return `
async (page) => {
  const input = ${JSON.stringify({ listing, publicUrl, editUrl })};
  const wait = (ms) => page.waitForTimeout(ms);
  const bodyText = async () => page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const visible = async (locator) => locator.isVisible().catch(() => false);
  const firstVisible = async (locators) => {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const item = locator.nth(i);
        if (await visible(item)) return item;
      }
    }
    return null;
  };
  const fill = async (name, locators, value) => {
    const field = await firstVisible(locators);
    if (!field) return { name, ok: false, reason: 'not_found' };
    await field.fill(String(value), { timeout: 5000 }).catch(async () => {
      await field.click({ timeout: 2000 });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type(String(value));
    });
    return { name, ok: true };
  };

  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  let text = await bodyText();
  if (page.url().includes('/login') || page.url().includes('/register')) {
    return { status: 'login_required', url: page.url() };
  }

  if (input.editUrl) {
    await page.goto(input.editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (!page.url().includes('/game/edit/')) {
    const projectUrl = input.publicUrl.split('?')[0].replace(/\\/$/u, '');
    const projectLink = page.locator(\`a[href="\${projectUrl}"], a[href="\${projectUrl}/"]\`).first();
    const projectRow = page.locator('.game_row').filter({ has: projectLink }).first();
    const direct = projectRow.locator('a[href*="/game/edit/"]').first();
    if (!(await direct.count().catch(() => 0))) {
      return { status: 'project_not_found', url: page.url() };
    }
    await direct.click({ timeout: 5000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  }

  text = await bodyText();
  if (page.url().includes('/login') || page.url().includes('/register')
    || (/log in|sign in/i.test(text) && !/edit game|edit project|uploads/i.test(text))) {
    return { status: 'login_required', url: page.url() };
  }
  if (!page.url().includes('itch.io/game/edit/') && !/edit game|edit project/i.test(text)) {
    return { status: 'unexpected_page', url: page.url(), body: text.slice(0, 500) };
  }

  const changes = [];
  changes.push(await fill('title', [
    page.locator('input[name="title"], input[name="game[title]"]'),
    page.getByLabel(/^title$/i),
  ], input.listing.title));
  changes.push(await fill('short_description', [
    page.locator('input[name="short_text"], textarea[name="short_text"], input[name="game[short_text]"]'),
    page.getByLabel(/short description/i),
  ], input.listing.short_description));
  changes.push(await fill('description', [
    page.locator('textarea[name="description"], textarea[name="game[description]"]'),
    page.getByLabel(/description/i),
    page.locator('[contenteditable="true"]').first(),
  ], input.listing.description));

  const paidButton = await firstVisible([
    page.locator('button.payment_mode_paid'),
    page.getByRole('button', { name: /^paid$/i }),
  ]);
  if (paidButton) {
    await paidButton.click({ timeout: 5000 });
    await wait(250);
  }
  changes.push(await fill('price', [
    page.locator('input[name="min_price"], input[name="price"], input[name="game[min_price]"]'),
    page.getByLabel(/minimum price|price/i),
  ], Number(input.listing.suggested_price.amount).toFixed(2)));

  const tagSlugs = input.listing.tags.map((tag) => String(tag).trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')).filter(Boolean);
  const tagResult = await page.locator('input').evaluateAll((nodes, slugs) => {
    const field = nodes.find((node) => node.name === 'game[tags]');
    const widget = field?.selectize;
    if (!widget) return { ok: false, reason: 'widget_not_found' };
    widget.clear(true);
    for (const slug of slugs) {
      if (!widget.options[slug]) widget.addOption({ slug });
      widget.addItem(slug, true);
    }
    widget.refreshItems();
    widget.updateOriginalInput({ silent: true });
    return { ok: slugs.every((slug) => widget.items.includes(slug)), items: [...widget.items] };
  }, tagSlugs).catch((error) => ({ ok: false, reason: String(error?.message || error).slice(0, 160) }));
  changes.push({ name: 'tags', ...tagResult });

  const missing = changes.filter((change) => !change.ok);
  if (missing.length) return { status: 'fields_not_found', url: page.url(), changes, missing };
  return { status: 'prepared', url: page.url(), changes };
}`.trim();
}

function buildScreenshotCountRunCode() {
  return `
async (page) => {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(750);
  return {
    status: 'screenshots_counted',
    count: await page.locator('button.delete_screen_btn').count().catch(() => 0),
    url: page.url(),
  };
}`.trim();
}

function buildDeleteScreenshotRunCode() {
  return `
async (page) => {
  const button = page.locator('button.delete_screen_btn').first();
  if (!(await button.count().catch(() => 0))) {
    return { status: 'screenshot_not_found', url: page.url() };
  }
  await button.click({ timeout: 5000 });
  return { status: 'screenshot_delete_requested' };
}`.trim();
}

function buildMediaTriggerRunCode(kind) {
  return `
async (page) => {
  const kind = ${JSON.stringify(kind)};
  const button = kind === 'cover'
    ? page.getByRole('button', { name: /upload cover image|replace cover image|change cover/i }).first()
    : page.getByRole('button', { name: /add screenshots/i }).first();
  if (!(await button.count().catch(() => 0))) {
    return { status: 'media_button_not_found', kind, url: page.url() };
  }
  await button.click({ timeout: 5000 });
  return { status: 'chooser_opened', kind };
}`.trim();
}

function buildSaveRunCode() {
  return `
async (page) => {
  const save = page.locator('button.save_btn').last();
  if (!(await save.count().catch(() => 0))) return { status: 'save_not_found', url: page.url() };
  await save.click({ timeout: 5000 });
  return { status: 'submitted', url: page.url() };
}`.trim();
}

function buildVerifyRunCode({ listing, screenshotCount, screenshotPath }) {
  return `
async (page) => {
  const input = ${JSON.stringify({ listing, screenshotCount, screenshotPath })};
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const titleValue = await page.locator('input[name="game[title]"]').first().inputValue().catch(() => '');
  const shortValue = await page.locator('input[name="game[short_text]"]').first().inputValue().catch(() => '');
  const descriptionValue = await page.locator('textarea[name="game[description]"]').first().inputValue().catch(() => '');
  const priceValue = await page.locator('input[name="game[min_price]"]').first().inputValue().catch(() => '');
  const paymentMode = await page.locator('input[name="game[payment_mode]"]').first().inputValue().catch(() => '');
  const numericPrice = Number(String(priceValue).replace(/[^0-9.]/gu, ''));
  const expectedPrice = Number(input.listing.suggested_price.amount);
  const actualTags = (await page.locator('.selectize-input .item').allTextContents().catch(() => []))
    .map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const expectedTags = input.listing.tags.map((tag) => String(tag).trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')).filter(Boolean);
  const tagsMatch = expectedTags.length === actualTags.length
    && expectedTags.every((tag) => actualTags.includes(tag));
  const coverId = await page.locator('input[name="game[cover_image_id]"]').first().inputValue().catch(() => '');
  const actualScreenshotCount = await page.locator('button.delete_screen_btn').count().catch(() => 0);
  const isDraft = await page.locator('input[name="game[published]"][value="draft"]').isChecked().catch(() => false);
  await page.screenshot({ path: input.screenshotPath, fullPage: true }).catch(() => {});
  const checks = {
    title: titleValue === input.listing.title,
    short_description: shortValue === input.listing.short_description,
    description: descriptionValue === input.listing.description,
    price: paymentMode === 'paid' && Math.abs(numericPrice - expectedPrice) < 0.001,
    tags: tagsMatch,
    cover: Boolean(coverId),
    screenshots: actualScreenshotCount === input.screenshotCount,
    draft: isDraft,
  };
  return {
    status: Object.values(checks).every(Boolean) ? 'verified' : 'verification_failed',
    url: page.url(),
    checks,
    titleValue,
    shortValue,
    priceValue,
    paymentMode,
    actualTags,
    coverId,
    actualScreenshotCount,
  };
}`.trim();
}

export async function stageItchDraft(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  const [manifest, listing] = await Promise.all([
    readJson(resolve(exportRoot, 'manifest.json')),
    readJson(resolve(exportRoot, 'itch-listing-preview.json')),
  ]);
  if (manifest.listing_hash !== listing.listing_hash) {
    throw new Error('The itch.io listing hash does not match the packaged manifest.');
  }
  const publicUrl = normalizeItchUrl(options.itchUrl).toString();
  const target = butlerTargetFromUrl(publicUrl);
  const downloadRoot = resolve(exportRoot, 'download');
  if (!existsSync(downloadRoot)) {
    throw new Error('The packaged buyer download directory is missing; run the package step first.');
  }
  const statePath = resolve(productRoot, 'review', 'itch.json');
  let previous = null;
  try { previous = await readJson(statePath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (previous?.status === 'verified'
    && previous.manifest_hash === manifest.manifest_hash
    && previous.listing_hash === listing.listing_hash) {
    return { ...previous, reused: true, statePath };
  }

  const cliRunner = options.cliRunner || defaultCliRunner;
  const env = options.env || process.env;
  const homeButler = resolve(os.homedir(), 'bin', 'butler');
  const butlerExecutable = options.butlerExecutable
    || env.ITCH_BUTLER_EXECUTABLE
    || (existsSync(homeButler) ? homeButler : 'butler');
  const butler = cliRunner(butlerExecutable, [
    'push',
    downloadRoot,
    `${target}:assets`,
    '--userversion',
    `review-${manifest.manifest_hash.slice(0, 12)}`,
    '--if-changed',
  ], { cwd: options.cwd, env, timeoutMs: 15 * 60_000 });
  if (!butler.ok) {
    throw new Error(`Butler could not stage the package: ${butler.stderr || butler.stdout || butler.error}`);
  }

  const profileDir = expandHomeDirectory(
    options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch',
  );
  const reviewRoot = resolve(productRoot, 'review');
  const screenshotPath = resolve(reviewRoot, 'itch-draft.png');
  await mkdir(reviewRoot, { recursive: true });
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const sessionName = options.sessionName || `orion-itch-${product.slug}`;
  const openUrl = String(options.itchEditUrl || '').trim() || 'https://itch.io/dashboard';
  const openArgs = ['-s', sessionName, 'open', openUrl, '--browser', 'chrome', '--persistent', '--profile', profileDir, '--json'];
  if (options.headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') openArgs.splice(-1, 0, '--headed');

  const opened = cliRunner(executable, openArgs, { cwd: options.cwd, env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open the itch.io editor: ${opened.stderr || opened.stdout || opened.error}`);
  try {
    const screenshotPaths = (listing.screenshot_paths || []).map((path) => resolve(exportRoot, path));
    const coverPath = resolve(exportRoot, listing.cover_path);
    const missingFiles = [coverPath, ...screenshotPaths].filter((path) => !existsSync(path));
    if (missingFiles.length) throw new Error(`Missing itch.io listing media: ${missingFiles.join(', ')}`);

    const runBrowserCode = (label, code) => {
      const result = cliRunner(executable, [
        '-s', sessionName, 'run-code', code, '--json',
      ], { cwd: options.cwd, env, timeoutMs: 3 * 60_000 });
      if (!result.ok) {
        throw new Error(`itch.io ${label} failed: ${result.stderr || result.stdout || result.error}`);
      }
      const details = parseCliJson(result.stdout) || {};
      if (details.isError) throw new Error(`itch.io ${label} failed: ${details.error || result.stdout}`);
      return { details, result };
    };
    const diagnostic = ({ details, result }) => {
      const parsed = JSON.stringify(details);
      return (parsed !== '{}'
        ? parsed
        : String(result.stdout || result.stderr || result.error || 'empty browser response')).slice(0, 800);
    };

    const prepareDraft = () => {
      const prepared = runBrowserCode('draft preparation', buildItchDraftRunCode({
        listing,
        publicUrl,
        editUrl: String(options.itchEditUrl || '').trim(),
      }));
      if (prepared.details.status !== 'prepared') {
        throw new Error(`itch.io draft preparation failed (${prepared.details.status || 'unknown'}): ${diagnostic(prepared)}`);
      }
      return prepared;
    };
    prepareDraft();

    let removedScreenshots = 0;
    let counted = runBrowserCode('screenshot count', buildScreenshotCountRunCode());
    while (Number(counted.details.count) > 0) {
      const before = Number(counted.details.count);
      runBrowserCode('screenshot replacement', buildDeleteScreenshotRunCode());
      counted = runBrowserCode('screenshot recount', buildScreenshotCountRunCode());
      if (Number(counted.details.count) >= before) {
        throw new Error(`itch.io screenshot replacement made no progress: ${diagnostic(counted)}`);
      }
      removedScreenshots += before - Number(counted.details.count);
    }
    if (removedScreenshots) prepareDraft();

    const uploadMedia = (kind, paths) => {
      if (!paths.length) return;
      const triggered = runBrowserCode(`${kind} chooser`, buildMediaTriggerRunCode(kind));
      if (triggered.details.status === 'media_button_not_found') {
        throw new Error(`itch.io ${kind} upload failed: ${diagnostic(triggered)}`);
      }
      const uploaded = cliRunner(executable, [
        '-s', sessionName, 'upload', ...paths, '--json',
      ], { cwd: options.cwd, env, timeoutMs: 3 * 60_000 });
      const uploadDetails = parseCliJson(uploaded.stdout) || {};
      if (!uploaded.ok || uploadDetails.isError) {
        throw new Error(`itch.io ${kind} upload failed: ${uploadDetails.error || uploaded.stderr || uploaded.stdout || uploaded.error}`);
      }
    };
    uploadMedia('cover', [coverPath]);
    uploadMedia('screenshots', screenshotPaths);

    const saved = runBrowserCode('draft save', buildSaveRunCode());
    if (saved.details.status === 'save_not_found') {
      throw new Error(`itch.io draft save failed: ${diagnostic(saved)}`);
    }

    const verified = runBrowserCode('draft verification', buildVerifyRunCode({
      listing,
      screenshotCount: screenshotPaths.length,
      screenshotPath,
    }));
    const details = verified.details;
    if (details.status !== 'verified') {
      throw new Error(`itch.io draft was not verified (${details.status || 'unknown'}): ${diagnostic(verified)}`);
    }
    const state = {
      schema_version: '1.0',
      status: 'verified',
      product_id: product.product_id,
      product_slug: product.slug,
      manifest_hash: manifest.manifest_hash,
      listing_hash: listing.listing_hash,
      public_url: publicUrl,
      edit_url: details.url,
      butler_target: `${target}:assets`,
      screenshot_path: screenshotPath,
      staged_at: options.now || new Date().toISOString(),
    };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return { ...state, reused: false, statePath, details };
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close'], { cwd: options.cwd, env, timeoutMs: 15_000 });
  }
}
