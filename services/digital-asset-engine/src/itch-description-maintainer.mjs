import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CanonicalProductStore } from './canonical-store.mjs';
import {
  defaultCliRunner,
  expandHomeDirectory,
  parseCliJson,
  renderItchDescriptionHtml,
} from './itch-draft-stager.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function buildDescriptionMaintenanceCode(input) {
  return `
async (page) => {
  const input = ${JSON.stringify(input)};
  await page.goto(input.editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const body = await page.locator('body').innerText().catch(() => '');
  if (page.url().includes('/login') || page.url().includes('/register')) return { status: 'login_required', url: page.url() };
  if (!page.url().includes('/game/edit/') && !/edit game|edit project/i.test(body)) {
    return { status: 'unexpected_editor', url: page.url() };
  }
  const updated = await page.locator('textarea').evaluateAll((nodes, html) => {
    const field = nodes.find((node) => node.name === 'game[description]');
    const redactor = field && window.jQuery?.(field).data('redactor');
    if (!field || !redactor?.code) return false;
    redactor.code.set(html);
    redactor.code.sync();
    redactor.code.flushSync();
    return Boolean(field.value);
  }, input.descriptionHtml).catch(() => false);
  if (!updated) return { status: 'description_editor_unavailable', url: page.url() };
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('/game/edit/')
    && String(response.request().postData() || '').includes('game%5Bdescription%5D='),
  { timeout: 15000 }).catch(() => null);
  const save = page.locator('form.game_edit_form button.save_btn').first();
  if (!(await save.count().catch(() => 0))) return { status: 'save_not_found', url: page.url() };
  await save.click({ timeout: 5000 });
  const response = await responsePromise;
  if (!response?.ok()) return { status: 'save_failed', httpStatus: response?.status() || null, url: page.url() };
  await page.goto(input.publicUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const description = page.locator('.formatted_description, .game_description').first();
  const visibleText = await description.innerText().catch(() => '');
  const headingCount = await description.locator('h1, h2, h3').count().catch(() => 0);
  const listCount = await description.locator('ul').count().catch(() => 0);
  const normalize = (value) => String(value).replace(/\\s+/gu, ' ').trim();
  const expected = await page.evaluate((html) => {
    const node = document.createElement('div');
    node.innerHTML = html;
    return node.innerText;
  }, input.descriptionHtml);
  const checks = {
    public_url: page.url().split('?')[0].replace(/\\/$/u, '') === input.publicUrl.replace(/\\/$/u, ''),
    text: normalize(visibleText) === normalize(expected),
    headings: headingCount === input.expectedHeadings,
    lists: listCount === input.expectedLists,
  };
  return { status: Object.values(checks).every(Boolean) ? 'verified' : 'verification_failed', checks, url: page.url() };
}`.trim();
}

export async function updatePublishedItchDescription(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({ productRoot, releaseVersion: options.releaseVersion });
  const releasePath = resolve(productRoot, 'review', 'itch-release.json');
  const release = await readJson(releasePath);
  if (release.status !== 'verified_public'
    || release.manifest_hash !== packaged.manifest.manifest_hash
    || release.listing_hash !== packaged.manifest.listing_hash) {
    throw new Error('Description maintenance requires the exact verified public release.');
  }
  const descriptionHtml = renderItchDescriptionHtml(packaged.listing.description);
  const presentationHash = createHash('sha256').update(descriptionHtml).digest('hex');
  const receiptPath = resolve(productRoot, 'review', 'itch-description.json');
  try {
    const previous = await readJson(receiptPath);
    if (previous.status === 'verified' && previous.presentation_hash === presentationHash
      && previous.manifest_hash === packaged.manifest.manifest_hash) {
      return { ...previous, reused: true, receiptPath };
    }
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const env = options.env || process.env;
  const runner = options.cliRunner || defaultCliRunner;
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const sessionName = options.sessionName || `orion-itch-description-${product.slug}`;
  const profile = expandHomeDirectory(options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch');
  const args = ['-s', sessionName, 'open', release.edit_url, '--browser', 'chrome', '--persistent', '--profile', profile, '--json'];
  if (options.headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') args.splice(-1, 0, '--headed');
  const opened = runner(executable, args, { env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open itch.io description editor: ${opened.stderr || opened.stdout || opened.error}`);
  const temp = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-description-'));
  try {
    const codePath = resolve(temp, 'update.js');
    writeFileSync(codePath, buildDescriptionMaintenanceCode({
      editUrl: release.edit_url,
      publicUrl: release.public_url,
      descriptionHtml,
      expectedHeadings: (descriptionHtml.match(/<h2>/gu) || []).length,
      expectedLists: (descriptionHtml.match(/<ul>/gu) || []).length,
    }), 'utf8');
    const result = runner(executable, ['-s', sessionName, 'run-code', '--filename', codePath, '--json'], {
      env,
      timeoutMs: 3 * 60_000,
    });
    const details = parseCliJson(result.stdout) || {};
    if (!result.ok || details.status !== 'verified') {
      throw new Error(`Published itch.io description was not verified: ${JSON.stringify(details).slice(0, 800) || result.stderr}`);
    }
    const receipt = {
      schema_version: '1.0',
      status: 'verified',
      product_id: product.product_id,
      product_slug: product.slug,
      target_version: packaged.manifest.target_version || product.version,
      manifest_hash: packaged.manifest.manifest_hash,
      listing_hash: packaged.manifest.listing_hash,
      presentation_hash: presentationHash,
      public_url: release.public_url,
      verified_at: options.now || new Date().toISOString(),
      verification: details.checks,
    };
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return { ...receipt, reused: false, receiptPath };
  } finally {
    runner(executable, ['-s', sessionName, 'close', '--json'], { env, timeoutMs: 15_000 });
    rmSync(temp, { recursive: true, force: true });
  }
}
