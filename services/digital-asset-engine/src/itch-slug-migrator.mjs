import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest } from './discord-review.mjs';
import { buildDistributionReviewEmbeds } from './distribution-review.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

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

function publicIdentity(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.itch.io')) {
    throw new Error('The existing itch.io URL is invalid.');
  }
  const account = url.hostname.slice(0, -'.itch.io'.length);
  const slug = url.pathname.split('/').filter(Boolean)[0];
  if (!account || !slug) throw new Error('Could not derive the itch.io account and project slug.');
  return { account, slug, url: `https://${account}.itch.io/${slug}` };
}

export function buildItchSlugMigrationCode({ editUrl, expectedTitle, targetSlug }) {
  return `
async (page) => {
  const input = ${JSON.stringify({ editUrl, expectedTitle, targetSlug })};
  const expectedDisplayName = input.targetSlug + '-assets.zip';
  await page.goto(input.editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(750);
  if (page.url().includes('/login')) return { status: 'login_required', url: page.url() };
  const title = await page.locator('input[name="game[title]"]').first().inputValue().catch(() => '');
  const slugField = page.locator('input[name="game[url]"]').first();
  const fallback = page.getByRole('textbox', { name: /project url/i }).first();
  const field = await slugField.count().catch(() => 0) ? slugField : fallback;
  if (!(await field.count().catch(() => 0))) return { status: 'slug_field_missing', title };
  const currentSlug = await field.inputValue();
  if (title !== input.expectedTitle) return { status: 'title_mismatch', title, currentSlug };
  const slugChanged = currentSlug !== input.targetSlug;
  if (slugChanged) await field.fill(input.targetSlug);

  const buttons = page.getByRole('button');
  let productionUpload = null;
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    const label = String(await button.innerText().catch(() => '')).replace(/\\s+/gu, ' ').trim();
    if (/(?:^|\\s)assets$/iu.test(label) && !/assets-preview$/iu.test(label)) {
      productionUpload = button.locator('xpath=ancestor::*[.//a[contains(normalize-space(.), "Change display name")]][1]');
      break;
    }
  }
  if (!productionUpload || !(await productionUpload.count().catch(() => 0))) {
    return { status: 'production_upload_missing', title, currentSlug };
  }
  let displayName = await productionUpload.locator('strong').first().innerText().catch(() => '');
  let displayNameChanged = false;
  if (displayName.trim() !== expectedDisplayName) {
    await productionUpload.getByRole('link', { name: /change display name/i }).click({ timeout: 5000 });
    const displayNameField = productionUpload.getByRole('textbox', { name: /enter a display name/i }).first();
    await displayNameField.waitFor({ state: 'visible', timeout: 5000 });
    await displayNameField.fill(expectedDisplayName);
    displayName = expectedDisplayName;
    displayNameChanged = true;
  }
  if (!slugChanged && !displayNameChanged) {
    return { status: 'already_migrated', title, currentSlug, displayName };
  }
  const save = page.locator('form.game_edit_form button.save_btn, button.save_btn').first();
  if (!(await save.count().catch(() => 0))) return { status: 'save_missing', title, currentSlug };
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('/game/edit/'), { timeout: 15000 }).catch(() => null);
  await save.click({ timeout: 5000 });
  const response = await responsePromise;
  if (!response || !response.ok()) return { status: 'save_failed', httpStatus: response?.status?.() || null };
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  const confirmed = await page.locator('input[name="game[url]"]').first().inputValue().catch(() => '');
  const confirmedTitle = await page.locator('input[name="game[title]"]').first().inputValue().catch(() => '');
  const confirmedDisplayName = await productionUpload.locator('strong').first().innerText().catch(async () => (
    productionUpload.getByRole('textbox', { name: /enter a display name/i }).first().inputValue().catch(() => '')
  ));
  return {
    status: confirmed === input.targetSlug && confirmedTitle === input.expectedTitle
      && confirmedDisplayName.trim() === expectedDisplayName ? 'migrated' : 'verification_failed',
    previousSlug: currentSlug,
    confirmed,
    title: confirmedTitle,
    displayName: confirmedDisplayName.trim(),
  };
}`.trim();
}

export async function migrateItchProjectSlug(options) {
  const targetSlug = String(options.targetSlug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(targetSlug)) throw new Error('The target itch.io slug is invalid.');
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({ productRoot, releaseVersion: options.releaseVersion });
  const paths = {
    itch: resolve(productRoot, 'review', 'itch.json'),
    release: resolve(productRoot, 'review', 'itch-release.json'),
    distribution: resolve(productRoot, 'review', 'distribution.json'),
    discord: resolve(productRoot, 'review', 'discord.json'),
    receipt: resolve(productRoot, 'review', 'itch-slug-migration.json'),
  };
  const [itch, release, distribution, discord, previousReceipt] = await Promise.all([
    readJson(paths.itch),
    readJson(paths.release),
    readJson(paths.distribution),
    readJson(paths.discord),
    readOptionalJson(paths.receipt),
  ]);
  if (release.status !== 'verified_public'
    || release.manifest_hash !== packaged.manifest.manifest_hash
    || release.listing_hash !== packaged.manifest.listing_hash
    || distribution.status !== 'published') {
    throw new Error('Slug migration requires the exact verified public release.');
  }
  const current = publicIdentity(release.public_url);
  const targetUrl = `https://${current.account}.itch.io/${targetSlug}`;
  const expectedDisplayName = `${targetSlug}-assets.zip`;
  if (previousReceipt?.status === 'verified'
    && previousReceipt.target_url === targetUrl
    && previousReceipt.download_display_name === expectedDisplayName
    && release.public_url === targetUrl) {
    return { ...previousReceipt, statePath: paths.receipt, reused: true };
  }
  const env = options.env || process.env;
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const cliRunner = options.cliRunner || defaultCliRunner;
  const profileDir = expandHomeDirectory(options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch');
  const sessionName = options.sessionName || `orion-itch-slug-${product.slug}`;
  const args = ['-s', sessionName, 'open', itch.edit_url, '--browser', 'chrome', '--persistent', '--profile', profileDir, '--json'];
  if (options.headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') args.splice(-1, 0, '--headed');
  const opened = cliRunner(executable, args, { cwd: options.cwd, env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open itch.io slug editor: ${opened.stderr || opened.stdout || opened.error}`);
  const codeRoot = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-slug-'));
  let details;
  try {
    const codePath = resolve(codeRoot, 'migrate.js');
    writeFileSync(codePath, buildItchSlugMigrationCode({
      editUrl: itch.edit_url,
      expectedTitle: packaged.listing.title,
      targetSlug,
    }), 'utf8');
    const result = cliRunner(executable, ['-s', sessionName, 'run-code', '--filename', codePath, '--json'], {
      cwd: options.cwd,
      env,
      timeoutMs: 3 * 60_000,
    });
    if (!result.ok) throw new Error(`itch.io slug migration failed: ${result.stderr || result.stdout || result.error}`);
    details = parseCliJson(result.stdout) || {};
    if (!['migrated', 'already_migrated'].includes(details.status)) {
      throw new Error(`itch.io slug migration was not verified: ${JSON.stringify(details)}`);
    }
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close', '--json'], { cwd: options.cwd, env, timeoutMs: 15_000 });
    rmSync(codeRoot, { recursive: true, force: true });
  }
  const publicFetch = options.publicFetchImpl || fetch;
  const response = await publicFetch(targetUrl, { redirect: 'follow' });
  const body = await response.text();
  if (!response.ok || !body.includes(packaged.listing.title)) {
    throw new Error(`The migrated itch.io URL was not publicly verified (${response.status}).`);
  }
  const migratedAt = options.now || new Date().toISOString();
  const butlerTarget = `${current.account}/${targetSlug}:assets`;
  const previousButlerTarget = release.butler_target;
  itch.public_url = targetUrl;
  itch.butler_target = butlerTarget;
  release.public_url = targetUrl;
  release.butler_target = butlerTarget;
  release.slug_migrated_at = migratedAt;
  distribution.public_url = targetUrl;
  distribution.publication = { ...distribution.publication, public_url: targetUrl };
  if (discord.itch_url) discord.itch_url = targetUrl;
  const receipt = {
    schema_version: '1.0',
    status: 'verified',
    product_id: product.product_id,
    product_slug: product.slug,
    manifest_hash: packaged.manifest.manifest_hash,
    listing_hash: packaged.manifest.listing_hash,
    previous_url: current.url,
    target_url: targetUrl,
    previous_butler_target: previousButlerTarget,
    butler_target: butlerTarget,
    title: packaged.listing.title,
    download_display_name: expectedDisplayName,
    migrated_at: migratedAt,
    anonymous_http: { reachable: response.ok, title: body.includes(packaged.listing.title) },
  };
  await Promise.all([
    writeFile(paths.itch, `${JSON.stringify(itch, null, 2)}\n`, 'utf8'),
    writeFile(paths.release, `${JSON.stringify(release, null, 2)}\n`, 'utf8'),
    writeFile(paths.distribution, `${JSON.stringify(distribution, null, 2)}\n`, 'utf8'),
    writeFile(paths.discord, `${JSON.stringify(discord, null, 2)}\n`, 'utf8'),
    writeFile(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
  ]);
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (token && distribution.channel_id && distribution.discord_message_id) {
    const message = await discordRequest(token, `/channels/${distribution.channel_id}/messages/${distribution.discord_message_id}`, {
      fetchImpl: options.fetchImpl,
    });
    await discordRequest(token, `/channels/${distribution.channel_id}/messages/${distribution.discord_message_id}`, {
      method: 'PATCH',
      body: {
        embeds: buildDistributionReviewEmbeds(message.embeds, distribution),
        components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open Public itch.io Page', url: targetUrl }] }],
      },
      fetchImpl: options.fetchImpl,
    });
  }
  return { ...receipt, details, statePath: paths.receipt, reused: false };
}
