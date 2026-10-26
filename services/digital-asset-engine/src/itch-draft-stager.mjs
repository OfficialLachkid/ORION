import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

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

export function expandHomeDirectory(path) {
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

export function defaultCliRunner(executable, args, options = {}) {
  return runnerResult(executable, args, spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: Number(options.timeoutMs) || 60_000,
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  }));
}

export function parseCliJson(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    return typeof parsed?.result === 'string' ? JSON.parse(parsed.result) : parsed;
  } catch {
    return null;
  }
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderItchDescriptionHtml(description) {
  const output = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    output.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const rawLine of String(description || '').split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    if (line.startsWith('- ')) {
      listItems.push(line.slice(2).trim());
      continue;
    }
    flushList();
    if (/^#{1,3}\s+/u.test(line)) {
      output.push(`<h2>${escapeHtml(line.replace(/^#{1,3}\s+/u, ''))}</h2>`);
    } else if (line.endsWith(':') && line.length <= 80) {
      output.push(`<h2>${escapeHtml(line)}</h2>`);
    } else {
      output.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  flushList();
  return output.join('\n');
}

export function renderItchDescriptionText(description) {
  return String(description || '')
    .split(/\r?\n/gu)
    .map((line) => line.trim().replace(/^#{1,3}\s+/u, '').replace(/^-\s+/u, ''))
    .filter(Boolean)
    .join(' ');
}

export function buildItchProjectDiscoveryRunCode({ slug }) {
  return `
async (page) => {
  const slug = ${JSON.stringify(String(slug || ''))};
  await page.goto('https://itch.io/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  if (page.url().includes('/login') || page.url().includes('/register')) {
    return { status: 'login_required', url: page.url() };
  }
  const creatorHref = await page.locator('a[href^="https://"][href*=".itch.io"]').evaluateAll((nodes) => {
    const link = nodes.find((node) => {
      const href = String(node.href || '');
      if (!href.startsWith('https://') || !href.endsWith('.itch.io/')) return false;
      const account = href.slice('https://'.length, -'.itch.io/'.length);
      return /^[a-z0-9-]+$/iu.test(account);
    });
    return link?.href || '';
  }).catch(() => '');
  if (!creatorHref) return { status: 'creator_url_not_found', url: page.url() };
  const creatorRoot = creatorHref.endsWith('/') ? creatorHref : creatorHref + '/';
  const publicUrl = creatorRoot + slug;
  const projectUrl = publicUrl.replace(/\\/$/u, '');
  const projectLink = page.locator(\`a[href="\${projectUrl}"], a[href="\${projectUrl}/"]\`).first();
  const projectRow = page.locator('.game_row').filter({ has: projectLink }).first();
  const editLink = projectRow.locator('a[href*="/game/edit/"]').first();
  if (await editLink.count().catch(() => 0)) {
    return {
      status: 'existing_project',
      publicUrl,
      editUrl: await editLink.evaluate((node) => node.href),
    };
  }
  await page.goto('https://itch.io/game/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(750);
  return { status: 'new_project_form', publicUrl, editUrl: page.url() };
}`.trim();
}

export function buildItchDraftRunCode({
  listing,
  publicUrl,
  editUrl,
  slug = '',
  create = false,
  save = false,
}) {
  return `
async (page) => {
  const input = ${JSON.stringify({
    listing,
    descriptionHtml: renderItchDescriptionHtml(listing.description),
    descriptionText: renderItchDescriptionText(listing.description),
    publicUrl,
    editUrl,
    slug,
    create,
    save,
  })};
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

  const currentUrl = page.url().replace(/#.*$/u, '').replace(/\\/$/u, '');
  const requestedEditUrl = input.editUrl.replace(/#.*$/u, '').replace(/\\/$/u, '');
  if (input.create && !page.url().includes('/game/new')) {
    await page.goto('https://itch.io/game/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (!input.create && input.editUrl && currentUrl !== requestedEditUrl) {
    await page.goto(input.editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } else if (!input.create && !page.url().includes('/game/edit/')) {
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
  if (!input.create && !page.url().includes('itch.io/game/edit/') && !/edit game|edit project/i.test(text)) {
    return { status: 'unexpected_page', url: page.url(), body: text.slice(0, 500) };
  }

  const changes = [];
  changes.push(await fill('title', [
    page.locator('input[name="game[title]"]'),
  ], input.listing.title));
  changes.push(await fill('short_description', [
    page.locator('input[name="game[short_text]"]'),
  ], input.listing.short_description));
  if (input.create) {
    changes.push(await fill('slug', [
      page.locator('input[name="game[url]"]'),
      page.locator('input[name="game[slug]"]'),
      page.getByLabel(/project url/i),
    ], input.slug));
    const classification = await page.locator('input, select').evaluateAll((nodes) => {
      const field = nodes.find((node) => [
        'game[user_classification]',
        'game[classification]',
      ].includes(node.name));
      const widget = field?.selectize;
      if (!widget) return { ok: false, reason: 'widget_not_found' };
      widget.setValue('assets', true);
      widget.updateOriginalInput({ silent: true });
      return { ok: widget.getValue() === 'assets', value: widget.getValue() };
    }).catch((error) => ({ ok: false, reason: String(error?.message || error).slice(0, 160) }));
    if (!classification.ok) {
      const selector = await firstVisible([page.getByText(/^Games .*piece of software/iu)]);
      await selector?.click({ timeout: 5000 });
      const option = await firstVisible([page.getByText(/^Game assets .*Graphics/iu)]);
      await option?.click({ timeout: 5000 });
    }
    const classificationText = await bodyText();
    changes.push({ name: 'classification', ok: classification.ok || /Game assets .*Graphics/iu.test(classificationText) });
    changes.push({
      name: 'kind',
      ok: /Downloadable .*only have files/iu.test(classificationText),
      reason: /Downloadable .*only have files/iu.test(classificationText) ? undefined : 'unexpected_default',
    });
    changes.push({
      name: 'release_status',
      ok: /Released .*Project is complete/iu.test(classificationText),
      reason: /Released .*Project is complete/iu.test(classificationText) ? undefined : 'unexpected_default',
    });
    const aiDisclosure = await firstVisible([
      page.getByRole('radio', { name: /Yes .*Generative AI/i }),
      page.locator('input[name="game[ai_disclosure]"][value="yes"]'),
    ]);
    if (aiDisclosure) await aiDisclosure.check({ timeout: 5000 });
    changes.push({ name: 'ai_disclosure', ok: Boolean(aiDisclosure) });
    const draftVisibility = await firstVisible([
      page.getByRole('radio', { name: /^Draft/iu }),
      page.locator('input[name="game[published]"][value="draft"]'),
    ]);
    if (draftVisibility) await draftVisibility.check({ timeout: 5000 });
    changes.push({ name: 'visibility', ok: Boolean(draftVisibility) });
  }
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

  const descriptionResult = await page.locator('textarea').evaluateAll((nodes, inputDescription) => {
    const field = nodes.find((node) => node.name === 'game[description]');
    const redactor = field && window.jQuery?.(field).data('redactor');
    if (!field || !redactor?.code) return { ok: false, reason: 'redactor_not_found' };
    redactor.code.set(inputDescription.html);
    redactor.code.sync();
    redactor.code.flushSync();
    const visibleText = field.parentElement?.querySelector('[contenteditable="true"]')?.innerText || '';
    const normalize = (value) => String(value).normalize('NFKC')
      .replace(/[•◦▪●]/gu, ' ')
      .replace(/\\s+/gu, ' ')
      .trim();
    return {
      ok: normalize(visibleText) === normalize(inputDescription.text) && Boolean(field.value),
      length: field.value.length,
      visibleLength: visibleText.length,
    };
  }, { html: input.descriptionHtml, text: input.descriptionText }).catch((error) => ({
    ok: false,
    reason: String(error?.message || error).slice(0, 160),
  }));
  changes.push({ name: 'description', ...descriptionResult });

  const missing = changes.filter((change) => !change.ok);
  if (missing.length) return { status: 'fields_not_found', url: page.url(), changes, missing };
  if (input.save) {
    const formAction = await page.locator('form.game_edit_form').first()
      .evaluate((form) => form.action).catch(() => '');
    const saveButton = input.create
      ? page.getByRole('button', { name: /Save & view page/i }).first()
      : page.locator('form.game_edit_form button.save_btn').first();
    if (!(await saveButton.count().catch(() => 0))) {
      return { status: 'save_not_found', url: page.url(), changes };
    }
    const normalizedFormAction = formAction.replace(/\\/$/u, '');
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && (response.url().replace(/\\/$/u, '') === normalizedFormAction
        || response.url().includes('/game/edit/'))
      && String(response.request().postData() || '').includes('game%5Bdescription%5D='),
    { timeout: 15000 }).catch(() => null);
    await saveButton.click({ timeout: 5000 });
    const response = await responsePromise;
    if (!response) return { status: 'save_response_not_seen', url: page.url(), changes };
    if (!response.ok()) {
      return { status: 'save_failed', url: page.url(), httpStatus: response.status(), changes };
    }
    await wait(2500);
    const savedUrl = page.url();
    const ownerEditHref = await page.locator('a[href*="/game/edit/"]').first()
      .evaluate((node) => node.href).catch(() => '');
    const savedEditUrl = ownerEditHref
      || (formAction.includes('/game/edit/') ? formAction : input.editUrl);
    const previewHref = await page.locator(
      \`a[href*=".itch.io/\${input.slug}"]\`,
    ).first().evaluate((node) => node.href).catch(() => '');
    const savedPublicUrl = (() => {
      for (const candidate of [savedUrl, previewHref, input.publicUrl]) {
        const value = String(candidate || '').trim();
        if (!value.startsWith('https://')) continue;
        const authorityAndPath = value.slice('https://'.length);
        const slashIndex = authorityAndPath.indexOf('/');
        const hostname = slashIndex >= 0
          ? authorityAndPath.slice(0, slashIndex)
          : authorityAndPath;
        const account = hostname.endsWith('.itch.io')
          ? hostname.slice(0, -'.itch.io'.length)
          : '';
        if (account && /^[a-z0-9-]+$/iu.test(account)) {
          return value;
        }
      }
      return input.publicUrl;
    })();
    return {
      status: 'submitted',
      url: savedUrl,
      editUrl: savedEditUrl,
      publicUrl: savedPublicUrl,
      httpStatus: response.status(),
      changes,
    };
  }
  return { status: 'prepared', url: page.url(), changes };
}`.trim();
}

export function buildScreenshotCountRunCode() {
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

export function buildDraftEligibilityRunCode() {
  return `
async (page) => {
  const draft = await page.locator('input[name="game[published]"][value="draft"]')
    .isChecked().catch(() => false);
  const published = await page.locator('input[name="game[published]"][value="published"]')
    .isChecked().catch(() => false);
  return {
    status: published ? 'already_public' : draft ? 'draft' : 'unknown',
    draft,
    published,
    url: page.url(),
  };
}`.trim();
}

export function buildDeleteScreenshotRunCode() {
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

export function buildMediaTriggerRunCode(kind) {
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

export function buildMediaStateRunCode() {
  return `
async (page) => {
  await page.waitForTimeout(4000);
  return {
    status: 'media_ready',
    coverId: await page.locator('input[name="game[cover_image_id]"]').first().inputValue().catch(() => ''),
    screenshotCount: await page.locator('button.delete_screen_btn').count().catch(() => 0),
    url: page.url(),
  };
}`.trim();
}

export function buildVerifyRunCode({
  listing,
  screenshotCount,
  screenshotPath,
  editUrl = '',
  slug = '',
  expectedVisibility = 'draft',
}) {
  return `
async (page) => {
  const input = ${JSON.stringify({
    listing,
    descriptionHtml: renderItchDescriptionHtml(listing.description),
    descriptionText: renderItchDescriptionText(listing.description),
    screenshotCount,
    screenshotPath,
    editUrl,
    slug,
    expectedVisibility,
  })};
  if (input.editUrl && page.url().replace(/#.*$/u, '') !== input.editUrl.replace(/#.*$/u, '')) {
    await page.goto(input.editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const titleValue = await page.locator('input[name="game[title]"]').first().inputValue().catch(() => '');
  const shortValue = await page.locator('input[name="game[short_text]"]').first().inputValue().catch(() => '');
  const descriptionValue = await page.locator('.redactor-layer[contenteditable="true"]').first().innerText().catch(() => '');
  const priceValue = await page.locator('input[name="game[min_price]"]').first().inputValue().catch(() => '');
  const paymentMode = await page.locator('input[name="game[payment_mode]"]').first().inputValue().catch(() => '');
  const numericPrice = Number(String(priceValue).replace(/[^0-9.]/gu, ''));
  const expectedPrice = Number(input.listing.suggested_price.amount);
  const actualTags = await page.locator('input').evaluateAll((nodes) => {
    const field = nodes.find((node) => node.name === 'game[tags]');
    return [...(field?.selectize?.items || [])];
  }).catch(() => []);
  const expectedTags = input.listing.tags.map((tag) => String(tag).trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, ''))
    .map((tag) => tag === 'sci-fi' ? 'science-fiction' : tag).filter(Boolean);
  const tagsMatch = expectedTags.length === actualTags.length
    && expectedTags.every((tag) => actualTags.includes(tag));
  const coverId = await page.locator('input[name="game[cover_image_id]"]').first().inputValue().catch(() => '');
  const actualScreenshotCount = await page.locator('button.delete_screen_btn').count().catch(() => 0);
  const slugValue = await page.locator([
    'input[name="game[slug]"]',
    'input[name="game[url]"]',
  ].join(', ')).first().inputValue().catch(() => '');
  const classificationValue = await page.locator([
    'select[name="game[user_classification]"]',
    'input[name="game[user_classification]"]',
    'input[name="game[classification]"]',
  ].join(', ')).first().inputValue().catch(() => '');
  const aiDisclosure = await page.getByRole('radio', { name: /Yes .*Generative AI/i }).isChecked().catch(() => false);
  const pageText = await page.locator('body').innerText().catch(() => '');
  const isDraft = await page.locator('input[name="game[published]"][value="draft"]').isChecked().catch(() => false);
  const isPublished = await page.locator('input[name="game[published]"][value="published"]').isChecked().catch(() => false);
  await page.screenshot({ path: input.screenshotPath, fullPage: true }).catch(() => {});
  const normalizeDescription = (value) => String(value).normalize('NFKC')
    .replace(/[•◦▪●]/gu, ' ')
    .replace(/\\s+/gu, ' ')
    .trim();
  const checks = {
    title: titleValue === input.listing.title,
    short_description: shortValue === input.listing.short_description,
    description: normalizeDescription(descriptionValue)
      === normalizeDescription(input.descriptionText),
    price: paymentMode === 'paid' && Math.abs(numericPrice - expectedPrice) < 0.001,
    tags: tagsMatch,
    cover: Boolean(coverId),
    screenshots: actualScreenshotCount === input.screenshotCount,
    slug: !input.slug || slugValue === input.slug,
    classification: classificationValue === 'assets',
    kind: /Downloadable .*only have files/iu.test(pageText),
    release_status: /Released .*Project is complete/iu.test(pageText),
    ai_disclosure: aiDisclosure,
    visibility: input.expectedVisibility === 'published' ? isPublished : isDraft,
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
    slugValue,
    classificationValue,
    aiDisclosure,
    coverId,
    actualScreenshotCount,
  };
}`.trim();
}

export async function stageItchDraft(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({
    productRoot,
    releaseVersion: options.releaseVersion,
  });
  const exportRoot = packaged.root;
  const { manifest, listing } = packaged;
  let publicUrl = String(options.itchUrl || '').trim();
  if (publicUrl) publicUrl = normalizeItchUrl(publicUrl).toString();
  let editUrl = String(options.itchEditUrl || '').trim();
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
  let published = null;
  try {
    published = await readJson(resolve(productRoot, 'review', 'itch-release.json'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (published?.status === 'verified_public') {
    throw new Error(
      published.manifest_hash === manifest.manifest_hash
        ? 'This itch.io release is already public; draft staging is disabled for published projects.'
        : 'A verified itch.io release is already public. Review this update locally and use the separately approved marketplace-update publisher instead of mutating the live page through draft staging.',
    );
  }

  const cliRunner = options.cliRunner || defaultCliRunner;
  const env = options.env || process.env;
  const homeButler = resolve(os.homedir(), 'bin', 'butler');
  const butlerExecutable = options.butlerExecutable
    || env.ITCH_BUTLER_EXECUTABLE
    || (existsSync(homeButler) ? homeButler : 'butler');

  const profileDir = expandHomeDirectory(
    options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch',
  );
  const reviewRoot = resolve(productRoot, 'review');
  const screenshotPath = resolve(reviewRoot, 'itch-draft.png');
  await mkdir(reviewRoot, { recursive: true });
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const sessionName = options.sessionName || `orion-itch-${product.slug}`;
  const openUrl = editUrl || 'https://itch.io/dashboard';
  const openArgs = ['-s', sessionName, 'open', openUrl, '--browser', 'chrome', '--persistent', '--profile', profileDir, '--json'];
  if (options.headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') openArgs.splice(-1, 0, '--headed');

  const opened = cliRunner(executable, openArgs, { cwd: options.cwd, env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open the itch.io editor: ${opened.stderr || opened.stdout || opened.error}`);
  // A previously interrupted edit can leave a native confirmation dialog attached to
  // the persistent browser. Dismissing it is non-mutating and restores automation.
  cliRunner(executable, [
    '-s', sessionName, 'dialog-dismiss', '--json',
  ], { cwd: options.cwd, env, timeoutMs: 15_000 });
  const browserCodeRoot = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-playwright-'));
  let browserCodeIndex = 0;
  try {
    const screenshotPaths = (listing.screenshot_paths || []).map((path) => resolve(exportRoot, path));
    const coverPath = resolve(exportRoot, listing.cover_path);
    const missingFiles = [coverPath, ...screenshotPaths].filter((path) => !existsSync(path));
    if (missingFiles.length) throw new Error(`Missing itch.io listing media: ${missingFiles.join(', ')}`);

    const runBrowserCode = (label, code, maxAttempts = 1) => {
      browserCodeIndex += 1;
      const codePath = resolve(browserCodeRoot, `${String(browserCodeIndex).padStart(2, '0')}.js`);
      writeFileSync(codePath, code, 'utf8');
      let lastResult;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = cliRunner(executable, [
          '-s', sessionName, 'run-code', '--filename', codePath, '--json',
        ], { cwd: options.cwd, env, timeoutMs: 3 * 60_000 });
        lastResult = result;
        if (!result.ok) {
          throw new Error(`itch.io ${label} failed: ${result.stderr || result.stdout || result.error}`);
        }
        const details = parseCliJson(result.stdout) || {};
        if (details.isError) throw new Error(`itch.io ${label} failed: ${details.error || result.stdout}`);
        if (Object.keys(details).length) return { details, result };
        if (attempt < maxAttempts) pause(750);
      }
      return { details: {}, result: lastResult };
    };
    const diagnostic = ({ details, result }) => {
      const parsed = JSON.stringify(details);
      return (parsed !== '{}'
        ? parsed
        : String(result.stdout || result.stderr || result.error || 'empty browser response')).slice(0, 800);
    };

    const readiness = runBrowserCode('browser readiness', `
async (page) => {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(750);
  return { status: 'ready', url: page.url() };
}`.trim(), 3);
    if (readiness.details.status !== 'ready') {
      throw new Error(`itch.io browser readiness failed: ${diagnostic(readiness)}`);
    }

    let createProject = false;
    if (!publicUrl) {
      const discovery = runBrowserCode('project discovery', buildItchProjectDiscoveryRunCode({
        slug: product.slug,
      }), 3);
      if (!['existing_project', 'new_project_form'].includes(discovery.details.status)) {
        throw new Error(`itch.io project discovery failed (${discovery.details.status || 'unknown'}): ${diagnostic(discovery)}`);
      }
      publicUrl = normalizeItchUrl(discovery.details.publicUrl).toString();
      editUrl = String(discovery.details.editUrl || '');
      createProject = discovery.details.status === 'new_project_form';
    }

    if (!createProject) {
      const eligibility = runBrowserCode('draft eligibility', buildDraftEligibilityRunCode(), 3);
      if (eligibility.details.status === 'already_public') {
        const error = new Error(
          'The itch.io project is already public. Draft staging stopped before changing listing fields, media, or buyer files.',
        );
        error.code = 'ITCH_PROJECT_ALREADY_PUBLIC';
        throw error;
      }
      if (eligibility.details.status !== 'draft') {
        throw new Error(`itch.io draft eligibility could not be verified: ${diagnostic(eligibility)}`);
      }
    }

    const prepareDraft = (save = false) => {
      const prepared = runBrowserCode('draft preparation', buildItchDraftRunCode({
        listing,
        publicUrl,
        editUrl,
        slug: product.slug,
        create: createProject,
        save,
      }), 3);
      const expectedStatus = save ? 'submitted' : 'prepared';
      if (prepared.details.status !== expectedStatus) {
        throw new Error(`itch.io draft preparation failed (${prepared.details.status || 'unknown'}): ${diagnostic(prepared)}`);
      }
      return prepared;
    };
    prepareDraft();

    let counted = runBrowserCode('screenshot count', buildScreenshotCountRunCode(), 3);
    while (Number(counted.details.count) > 0) {
      const before = Number(counted.details.count);
      runBrowserCode('screenshot replacement', buildDeleteScreenshotRunCode());
      const accepted = cliRunner(executable, [
        '-s', sessionName, 'dialog-accept', '--json',
      ], { cwd: options.cwd, env, timeoutMs: 15_000 });
      const acceptedDetails = parseCliJson(accepted.stdout) || {};
      if (!accepted.ok || acceptedDetails.isError) {
        throw new Error(`itch.io screenshot confirmation failed: ${acceptedDetails.error || accepted.stderr || accepted.stdout || accepted.error}`);
      }
      counted = runBrowserCode('screenshot recount', buildScreenshotCountRunCode(), 3);
      if (Number(counted.details.count) >= before) {
        throw new Error(`itch.io screenshot replacement made no progress: ${diagnostic(counted)}`);
      }
    }

    const uploadMedia = (kind, paths) => {
      for (const path of paths) {
        const triggered = runBrowserCode(`${kind} chooser`, buildMediaTriggerRunCode(kind));
        if (triggered.details.status === 'media_button_not_found') {
          throw new Error(`itch.io ${kind} upload failed: ${diagnostic(triggered)}`);
        }
        // playwright-cli documents multiple files but currently accepts one positional
        // argument, so repeat the chooser/upload cycle for deterministic compatibility.
        const uploaded = cliRunner(executable, [
          '-s', sessionName, 'upload', path, '--json',
        ], { cwd: options.cwd, env, timeoutMs: 3 * 60_000 });
        const uploadDetails = parseCliJson(uploaded.stdout) || {};
        if (!uploaded.ok || uploadDetails.isError) {
          throw new Error(`itch.io ${kind} upload failed: ${uploadDetails.error || uploaded.stderr || uploaded.stdout || uploaded.error}`);
        }
      }
    };
    uploadMedia('screenshots', screenshotPaths);
    uploadMedia('cover', [coverPath]);
    const media = runBrowserCode('media readiness', buildMediaStateRunCode(), 3);
    if (!media.details.coverId || Number(media.details.screenshotCount) !== screenshotPaths.length) {
      throw new Error(`itch.io media did not settle before save: ${diagnostic(media)}`);
    }
    const submitted = prepareDraft(true);
    publicUrl = normalizeItchUrl(submitted.details.publicUrl || publicUrl).toString();
    editUrl = String(
      submitted.details.editUrl
      || (String(submitted.details.url || '').includes('itch.io/game/edit/') ? submitted.details.url : '')
      || editUrl,
    );
    if (createProject && !editUrl.includes('itch.io/game/edit/')) {
      const rediscovered = runBrowserCode('created project rediscovery', buildItchProjectDiscoveryRunCode({
        slug: product.slug,
      }), 3);
      if (rediscovered.details.status === 'existing_project'
        && String(rediscovered.details.editUrl || '').includes('itch.io/game/edit/')) {
        publicUrl = normalizeItchUrl(publicUrl || rediscovered.details.publicUrl).toString();
        editUrl = String(rediscovered.details.editUrl);
        createProject = false;
      } else {
        throw new Error(`itch.io did not expose the created project editor after save: ${diagnostic(rediscovered)}`);
      }
    }

    const target = butlerTargetFromUrl(publicUrl);
    const butler = cliRunner(butlerExecutable, [
      'push',
      downloadRoot,
      `${target}:assets`,
      '--userversion',
      `${manifest.target_version || product.version || 'review'}-${manifest.manifest_hash.slice(0, 12)}`,
      '--if-changed',
    ], { cwd: options.cwd, env, timeoutMs: 15 * 60_000 });
    if (!butler.ok) {
      throw new Error(`Butler could not stage the package: ${butler.stderr || butler.stdout || butler.error}`);
    }

    const verified = runBrowserCode('draft verification', buildVerifyRunCode({
      listing,
      screenshotCount: screenshotPaths.length,
      screenshotPath,
      editUrl,
      slug: product.slug,
    }), 3);
    const details = verified.details;
    if (details.status !== 'verified') {
      throw new Error(`itch.io draft was not verified (${details.status || 'unknown'}): ${diagnostic(verified)}`);
    }
    const state = {
      schema_version: '1.0',
      status: 'verified',
      product_id: product.product_id,
      product_slug: product.slug,
      target_version: manifest.target_version || product.version || null,
      manifest_hash: manifest.manifest_hash,
      listing_hash: listing.listing_hash,
      public_url: publicUrl,
      edit_url: editUrl || details.url,
      butler_target: `${target}:assets`,
      package_root: relative(productRoot, exportRoot).replaceAll('\\', '/'),
      screenshot_path: screenshotPath,
      staged_at: options.now || new Date().toISOString(),
    };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return { ...state, reused: false, statePath, details };
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close'], { cwd: options.cwd, env, timeoutMs: 15_000 });
    rmSync(browserCodeRoot, { recursive: true, force: true });
  }
}
