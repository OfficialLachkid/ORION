import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { resolveDistributionMarketplaceState } from './distribution-review.mjs';
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

export function buildItchSellerPreflightCode() {
  return `
async (page) => {
  const bodyText = async () => page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  await page.goto('https://itch.io/user/settings/seller', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const payoutText = await bodyText();
  if (page.url().includes('/login') || page.url().includes('/register')) {
    return { status: 'login_required', url: page.url() };
  }
  const checkedPayout = await page.locator('input[type="radio"]:checked').first()
    .evaluate((node) => node.closest('label, .radio, .choice')?.innerText || node.parentElement?.innerText || '')
    .catch(() => '');
  const collectedByItch = /collected by itch\.io/i.test(checkedPayout)
    || (/collected by itch\.io/i.test(payoutText)
      && await page.locator('input[type="radio"]:checked').first().count().catch(() => 0) > 0);
  const directToSeller = /direct to you/i.test(checkedPayout);
  const payoutMode = collectedByItch ? 'collected_by_itch' : directToSeller ? 'direct_to_seller' : 'unknown';

  await page.goto('https://itch.io/user/settings/seller/tax-information', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const taxText = await bodyText();
  const incompleteTax = /finish setting up your account|complete the tax interview/i.test(taxText)
    || await page.getByRole('button', { name: /begin interview/i }).count().catch(() => 0) > 0;
  const taxInterviewComplete = !incompleteTax;
  const blockers = [];
  if (payoutMode === 'unknown') blockers.push('payout_mode_unverified');
  if (!taxInterviewComplete) blockers.push('tax_interview_incomplete');
  return {
    status: blockers.length ? 'blocked' : 'ready',
    payout_mode: payoutMode,
    tax_interview_complete: taxInterviewComplete,
    blockers,
    settings_url: 'https://itch.io/user/settings/seller',
    tax_information_url: 'https://itch.io/user/settings/seller/tax-information',
  };
}`.trim();
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

export function resolveItchSellerMarketplaceState({
  product,
  manifest,
  discordState,
  itchState,
  publishedState,
}) {
  if (discordState?.last_decision?.decision !== 'approve'
    || discordState.manifest_hash !== manifest.manifest_hash
    || discordState.listing_hash !== manifest.listing_hash) {
    throw new Error('Seller readiness requires creative approval for this exact manifest and listing.');
  }
  return resolveDistributionMarketplaceState({
    product,
    manifest,
    discordState,
    itchState,
    publishedState,
  });
}

export async function inspectItchSellerReadiness(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({
    productRoot,
    releaseVersion: options.releaseVersion,
  });
  const [discordState, itchState, publishedState] = await Promise.all([
    readJson(resolve(productRoot, 'review', 'discord.json')),
    readOptionalJson(resolve(productRoot, 'review', 'itch.json')),
    readOptionalJson(resolve(productRoot, 'review', 'itch-release.json')),
  ]);
  const marketplaceState = resolveItchSellerMarketplaceState({
    product,
    manifest: packaged.manifest,
    discordState,
    itchState,
    publishedState,
  });

  const cliRunner = options.cliRunner || defaultCliRunner;
  const env = options.env || process.env;
  const executable = options.playwrightExecutable || env.PLAYWRIGHT_CLI || 'playwright-cli';
  const sessionName = options.sessionName || `orion-itch-seller-${product.slug}`;
  const profileDir = expandHomeDirectory(
    options.profileDir || env.ITCH_PLAYWRIGHT_PROFILE || '~/.orion/playwright-profile-itch',
  );
  const openArgs = [
    '-s', sessionName, 'open', marketplaceState.editUrl || 'https://itch.io/dashboard',
    '--browser', 'chrome', '--persistent', '--profile', profileDir, '--json',
  ];
  if (options.headed !== false && env.ITCH_PLAYWRIGHT_HEADED !== 'false') openArgs.splice(-1, 0, '--headed');
  const opened = cliRunner(executable, openArgs, { cwd: options.cwd, env, timeoutMs: 90_000 });
  if (!opened.ok) throw new Error(`Could not open itch.io seller settings: ${opened.stderr || opened.stdout || opened.error}`);

  const codeRoot = mkdtempSync(resolve(os.tmpdir(), 'orion-itch-seller-'));
  try {
    const codePath = resolve(codeRoot, 'preflight.js');
    writeFileSync(codePath, buildItchSellerPreflightCode(), 'utf8');
    const checked = cliRunner(executable, [
      '-s', sessionName, 'run-code', '--filename', codePath, '--json',
    ], { cwd: options.cwd, env, timeoutMs: 3 * 60_000 });
    if (!checked.ok) {
      throw new Error(`itch.io seller readiness failed: ${checked.stderr || checked.stdout || checked.error}`);
    }
    const details = parseCliJson(checked.stdout) || {};
    if (details.isError) throw new Error(`itch.io seller readiness failed: ${details.error}`);
    if (!['ready', 'blocked'].includes(details.status)) {
      throw new Error(`itch.io seller readiness returned ${details.status || 'an empty result'}.`);
    }
    const state = {
      schema_version: '1.0',
      status: details.status,
      product_id: product.product_id,
      product_slug: product.slug,
      target_version: packaged.manifest.target_version || product.version || null,
      manifest_hash: packaged.manifest.manifest_hash,
      listing_hash: packaged.manifest.listing_hash,
      marketplace: 'itch.io',
      marketplace_review_mode: marketplaceState.mode,
      current_marketplace_version: marketplaceState.currentVersion,
      base_manifest_hash: packaged.manifest.base_manifest_hash || null,
      payout_mode: details.payout_mode,
      tax_interview_complete: details.tax_interview_complete,
      blockers: details.blockers,
      settings_url: details.settings_url,
      tax_information_url: details.tax_information_url,
      checked_at: options.now || new Date().toISOString(),
    };
    const statePath = resolve(productRoot, 'review', 'itch-seller.json');
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return { ...state, statePath };
  } finally {
    cliRunner(executable, ['-s', sessionName, 'close', '--json'], {
      cwd: options.cwd,
      env,
      timeoutMs: 15_000,
    });
    rmSync(codeRoot, { recursive: true, force: true });
  }
}
