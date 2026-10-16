import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest } from './discord-review.mjs';
import { buildDistributionReviewEmbeds } from './distribution-review.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

function parseCliJson(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    return typeof parsed?.result === 'string' ? JSON.parse(parsed.result) : parsed;
  } catch {
    return null;
  }
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

function expandHomeDirectory(path) {
  const value = String(path || '').trim();
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return resolve(os.homedir(), value.slice(2));
  return resolve(value);
}

function publicUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.itch.io')) {
    throw new Error('The itch.io public URL must use https://*.itch.io.');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
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

export function buildItchPublishCode({ listing, editUrl }) {
  return `
async (page) => {
  const input = ${JSON.stringify({ listing, editUrl })};
  await page.goto(input.editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (page.url().includes('/login') || page.url().includes('/register')) {
    return { status: 'login_required', url: page.url() };
  }
  const title = await page.locator('input[name="game[title]"]').first().inputValue().catch(() => '');
  const shortDescription = await page.locator('input[name="game[short_text]"]').first().inputValue().catch(() => '');
  const paymentMode = await page.locator('input[name="game[payment_mode]"]').first().inputValue().catch(() => '');
  const priceValue = await page.locator('input[name="game[min_price]"]').first().inputValue().catch(() => '');
  const price = Number(String(priceValue).replace(/[^0-9.]/gu, ''));
  const coverId = await page.locator('input[name="game[cover_image_id]"]').first().inputValue().catch(() => '');
  const screenshotCount = await page.locator('button.delete_screen_btn').count().catch(() => 0);
  const draft = await page.locator('input[name="game[published]"][value="draft"]').isChecked().catch(() => false);
  const published = await page.locator('input[name="game[published]"][value="published"]').isChecked().catch(() => false);
  const checks = {
    editor: page.url().includes('/game/edit/'),
    title: title === input.listing.title,
    short_description: shortDescription === input.listing.short_description,
    paid: paymentMode === 'paid' && Math.abs(price - Number(input.listing.suggested_price.amount)) < 0.001,
    cover: Boolean(coverId),
    screenshots: screenshotCount === input.listing.screenshot_paths.length,
    visibility: draft || published,
  };
  if (!Object.values(checks).every(Boolean)) {
    return { status: 'preflight_failed', checks, title, shortDescription, paymentMode, priceValue, coverId, screenshotCount };
  }
  if (published) return { status: 'already_public', checks, url: page.url() };
  const publicRadio = page.locator('input[name="game[published]"][value="published"]').first();
  await publicRadio.check({ timeout: 5000 });
  const saveButton = page.locator('form.game_edit_form button.save_btn, button.save_btn').first();
  if (!(await saveButton.count().catch(() => 0))) return { status: 'save_not_found', checks };
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().includes('/game/edit/'), { timeout: 15000 }).catch(() => null);
  await saveButton.click({ timeout: 5000 });
  const response = await responsePromise;
  if (!response || !response.ok()) {
    return { status: 'save_failed', http_status: response?.status?.() || null, checks };
  }
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  const confirmed = await page.locator('input[name="game[published]"][value="published"]').isChecked().catch(() => false);
  return { status: confirmed ? 'published' : 'verification_failed', checks, confirmed, url: page.url() };
}`.trim();
}

export function buildItchPublicVerificationCode({ listing, url, screenshotPath }) {
  return `
async (page) => {
  const input = ${JSON.stringify({ listing, url, screenshotPath })};
  await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const title = await page.locator('h1.game_title, h1[itemprop="name"]').first()
    .innerText({ timeout: 5000 }).catch(() => '');
  const documentTitle = await page.title().catch(() => '');
  const buyButton = page.getByText(/buy now|download now|purchase/i).first();
  const buyVisible = await buyButton.isVisible().catch(() => false);
  if (buyVisible) {
    await buyButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(750);
  }
  const purchaseText = await page.locator('[role="dialog"], .purchase_dialog, .lightbox').last()
    .innerText().catch(() => '');
  const priceText = Number(input.listing.suggested_price.amount).toFixed(2);
  const checks = {
    public_url: page.url().split('?')[0].replace(/\\/$/u, '') === input.url.replace(/\\/$/u, ''),
    title: title.trim() === input.listing.title
      || documentTitle.trim() === input.listing.title
      || documentTitle.startsWith(input.listing.title + ' by '),
    buy_action: buyVisible,
    price: text.includes(priceText),
    included_file: /\\.zip\\b/i.test([text, purchaseText].join(' ')),
    payment_options: /paypal|pay with card|credit card/i.test(purchaseText),
    not_draft_error: !/page is currently in draft|page not found|you do not have access/i.test(text),
  };
  await page.screenshot({ path: input.screenshotPath, fullPage: true }).catch(() => {});
  return {
    status: Object.values(checks).every(Boolean) ? 'verified_public' : 'public_verification_failed',
    checks,
    url: page.url(),
    title,
    document_title: documentTitle,
  };
}`.trim();
}

export async function publishApprovedItchRelease(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({ productRoot, releaseVersion: options.releaseVersion });
  const [discordState, itchState, sellerState, distributionState] = await Promise.all([
    readJson(resolve(productRoot, 'review', 'discord.json')),
    readJson(resolve(productRoot, 'review', 'itch.json')),
    readJson(resolve(productRoot, 'review', 'itch-seller.json')),
    readJson(resolve(productRoot, 'review', 'distribution.json')),
  ]);
  const manifestHash = packaged.manifest.manifest_hash;
  const listingHash = packaged.manifest.listing_hash;
  if (discordState.last_decision?.decision !== 'approve'
    || discordState.manifest_hash !== manifestHash
    || discordState.listing_hash !== listingHash) {
    throw new Error('Publishing requires creative approval for this exact release.');
  }
  if (itchState.status !== 'verified'
    || itchState.manifest_hash !== manifestHash
    || itchState.listing_hash !== listingHash) {
    throw new Error('Publishing requires the exact verified itch.io draft.');
  }
  if (sellerState.status !== 'ready'
    || sellerState.manifest_hash !== manifestHash
    || sellerState.listing_hash !== listingHash) {
    throw new Error('Publishing requires current seller readiness for this exact release.');
  }
  if (!['distribution_approved', 'published'].includes(distributionState.status)
    || distributionState.last_decision?.decision !== 'approve_publish'
    || distributionState.manifest_hash !== manifestHash
    || distributionState.listing_hash !== listingHash) {
    throw new Error(`Publishing requires a separate distribution approval for this exact release (${JSON.stringify({
      status: distributionState.status,
      decision: distributionState.last_decision?.decision || null,
      manifest_matches: distributionState.manifest_hash === manifestHash,
      listing_matches: distributionState.listing_hash === listingHash,
    })}).`);
  }
  const releaseStatePath = resolve(productRoot, 'review', 'itch-release.json');
  const previous = await readOptionalJson(releaseStatePath);
  if (previous?.status === 'verified_public'
    && previous.manifest_hash === manifestHash
    && previous.listing_hash === listingHash) {
    return { ...previous, reused: true, statePath: releaseStatePath };
  }

  const env = options.env || process.env;
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const sessionName = options.sessionName || `orion-itch-publish-${product.slug}`;
  const profileDir = expandHomeDirectory(
    options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch',
  );
  const cliRunner = options.cliRunner || defaultCliRunner;
  const openArgs = [
    '-s', sessionName, 'open', itchState.edit_url, '--browser', 'chrome',
    '--persistent', '--profile', profileDir, '--json',
  ];
  if (options.headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') openArgs.splice(-1, 0, '--headed');
  const opened = cliRunner(executable, openArgs, { cwd: options.cwd, env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open itch.io publication editor: ${opened.stderr || opened.stdout || opened.error}`);
  const codeRoot = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-publish-'));
  try {
    const runCode = (filename, code) => {
      const codePath = resolve(codeRoot, filename);
      writeFileSync(codePath, code, 'utf8');
      const result = cliRunner(executable, ['-s', sessionName, 'run-code', '--filename', codePath, '--json'], {
        cwd: options.cwd,
        env,
        timeoutMs: 3 * 60_000,
      });
      if (!result.ok) throw new Error(`itch.io publication failed: ${result.stderr || result.stdout || result.error}`);
      const details = parseCliJson(result.stdout) || {};
      if (details.isError) throw new Error(`itch.io publication failed: ${details.error}`);
      return details;
    };
    const published = runCode('publish.js', buildItchPublishCode({
      listing: packaged.listing,
      editUrl: itchState.edit_url,
    }));
    if (!['published', 'already_public'].includes(published.status)) {
      throw new Error(`itch.io visibility was not changed (${published.status || 'unknown'}).`);
    }
    const cleanPublicUrl = publicUrl(itchState.public_url);
    const screenshotPath = resolve(productRoot, 'review', 'itch-public.png');
    const verified = runCode('verify.js', buildItchPublicVerificationCode({
      listing: packaged.listing,
      url: cleanPublicUrl,
      screenshotPath,
    }));
    if (verified.status !== 'verified_public') {
      throw new Error(`itch.io public page verification failed: ${JSON.stringify(verified.checks || {})}`);
    }
    const anonymousResponse = await (options.publicFetchImpl || fetch)(cleanPublicUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'ORION-Digital-Asset-Publication-Verifier/1.0' },
    });
    const anonymousBody = await anonymousResponse.text();
    const anonymousChecks = {
      reachable: anonymousResponse.ok,
      title: anonymousBody.includes(packaged.listing.title),
      not_draft_error: !/page is currently in draft|page not found|you do not have access/iu.test(anonymousBody),
    };
    if (!Object.values(anonymousChecks).every(Boolean)) {
      throw new Error(`itch.io anonymous verification failed: ${JSON.stringify(anonymousChecks)}`);
    }
    const state = {
      schema_version: '1.0',
      status: 'verified_public',
      product_id: product.product_id,
      product_slug: product.slug,
      target_version: packaged.manifest.target_version || product.version || null,
      manifest_hash: manifestHash,
      listing_hash: listingHash,
      marketplace: 'itch.io',
      public_url: cleanPublicUrl,
      edit_url: itchState.edit_url,
      butler_target: itchState.butler_target,
      distribution_interaction_id: distributionState.last_decision.discord_interaction_id,
      published_at: options.now || new Date().toISOString(),
      verified_at: options.now || new Date().toISOString(),
      verification: { ...verified.checks, anonymous_http: anonymousChecks },
      screenshot_path: screenshotPath,
    };
    await mkdir(dirname(releaseStatePath), { recursive: true });
    await writeFile(releaseStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    distributionState.status = 'published';
    distributionState.publication = {
      public_url: state.public_url,
      published_at: state.published_at,
      verified_at: state.verified_at,
      release_state_path: 'review/itch-release.json',
    };
    await writeFile(
      resolve(productRoot, 'review', 'distribution.json'),
      `${JSON.stringify(distributionState, null, 2)}\n`,
      'utf8',
    );

    const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
    if (token && distributionState.channel_id && distributionState.discord_message_id) {
      const current = await discordRequest(
        token,
        `/channels/${distributionState.channel_id}/messages/${distributionState.discord_message_id}`,
        { fetchImpl: options.fetchImpl },
      );
      await discordRequest(token, `/channels/${distributionState.channel_id}/messages/${distributionState.discord_message_id}`, {
        method: 'PATCH',
        body: {
          embeds: buildDistributionReviewEmbeds(current?.embeds, distributionState),
          components: [{
            type: 1,
            components: [{ type: 2, style: 5, label: 'Open Public itch.io Page', url: cleanPublicUrl }],
          }],
        },
        fetchImpl: options.fetchImpl,
      });
    }
    return { ...state, reused: false, statePath: releaseStatePath };
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close', '--json'], {
      cwd: options.cwd,
      env,
      timeoutMs: 15_000,
    });
    rmSync(codeRoot, { recursive: true, force: true });
  }
}
