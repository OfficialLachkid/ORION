import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

function resolveInside(rootPath, candidatePath, label) {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const child = relative(root, target);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside ${root}.`);
  return target;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertHash(value, label) {
  if (!/^[a-f0-9]{64}$/u.test(String(value || ''))) throw new Error(`${label} must be a SHA-256 hash.`);
}

export async function resolvePackagedRelease({ productRoot, releaseVersion }) {
  if (!releaseVersion) {
    const root = resolveInside(productRoot, 'exports/itch-preview', 'Preview package');
    const manifestPath = resolveInside(root, 'manifest.json', 'Preview manifest');
    const listingPath = resolveInside(root, 'itch-listing-preview.json', 'Preview listing');
    const [manifest, listing] = await Promise.all([readJson(manifestPath), readJson(listingPath)]);
    if (manifest.release_state !== 'internal_preview' || manifest.distribution_ready !== false) {
      throw new Error('Base itch staging requires an internal preview with distribution blocked.');
    }
    if (manifest.listing_hash !== listing.listing_hash) {
      throw new Error('The itch.io listing hash does not match the packaged manifest.');
    }
    return { root, manifestPath, listingPath, manifest, listing, releaseVersion: null };
  }

  if (!/^\d+\.\d+\.\d+$/u.test(releaseVersion)) {
    throw new Error('Release version must use semantic version format.');
  }
  const versionRoot = resolveInside(productRoot, `releases/${releaseVersion}`, 'Release version');
  const pointer = await readJson(resolveInside(versionRoot, 'latest-candidate.json', 'Candidate pointer'));
  if (pointer.target_version !== releaseVersion) {
    throw new Error('Latest candidate points at a different target version.');
  }
  const root = resolveInside(productRoot, pointer.candidate_path, 'Release candidate');
  const manifestPath = resolveInside(root, 'manifest.json', 'Candidate manifest');
  const listingPath = resolveInside(root, 'itch-listing.json', 'Candidate listing');
  const [manifest, listing] = await Promise.all([readJson(manifestPath), readJson(listingPath)]);
  assertHash(pointer.manifest_hash, 'Candidate pointer manifest hash');
  if (manifest.manifest_hash !== pointer.manifest_hash || manifest.target_version !== releaseVersion) {
    throw new Error('Latest candidate pointer does not match the candidate manifest.');
  }
  if (manifest.release_state !== 'awaiting_extension_review'
    || manifest.distribution_ready !== false
    || manifest.gates?.quality_holds_resolved !== true
    || manifest.quality_holds?.length) {
    throw new Error('Release candidate is not eligible for draft staging and package review.');
  }
  if (manifest.listing_hash !== listing.listing_hash) {
    throw new Error('Candidate listing hash does not match its manifest.');
  }
  return { root, manifestPath, listingPath, manifest, listing, releaseVersion };
}
