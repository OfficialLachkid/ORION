import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedEvidence(report) {
  return (report.evidence || []).map((row) => ({
    listing_url: row.listing_url,
    view_id: row.view_id,
    title: String(row.title || '').trim().toLowerCase(),
    creator: String(row.creator || '').trim().toLowerCase(),
    current_rank: row.current_rank,
    previous_rank: row.previous_rank,
  })).sort((left, right) => `${left.view_id}|${left.listing_url}`.localeCompare(
    `${right.view_id}|${right.listing_url}`,
  ));
}

export function researchEvidenceFingerprint(report) {
  return sha256({
    cluster: report.evidence_cluster?.concept || '',
    evidence: normalizedEvidence(report),
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function persistResearchAnalysisState(options) {
  const root = resolve(options.archiveRoot, 'analysis');
  const statePath = resolve(root, 'latest.json');
  await mkdir(root, { recursive: true });
  const previous = await readJson(statePath);
  const evidenceFingerprint = researchEvidenceFingerprint(options.report);
  const analysisIssue = String(options.analysisIssue || '');
  const resultFingerprint = sha256({ evidenceFingerprint, analysisIssue });
  const duplicate = previous?.result_fingerprint === resultFingerprint;
  const state = {
    schema: 'orion-digital-asset-research-analysis.v1',
    status: options.recommendation ? 'recommendation' : 'monitoring',
    observed_at: options.observedAt,
    evidence_fingerprint: evidenceFingerprint,
    result_fingerprint: resultFingerprint,
    duplicate_of_previous: duplicate,
    occurrence_count: duplicate ? Number(previous.occurrence_count || 1) + 1 : 1,
    analysis_issue: analysisIssue,
    evidence_cluster: options.report.evidence_cluster || null,
    recommendation_id: options.recommendation?.recommendation_id || null,
  };
  await writeJsonAtomic(statePath, state);
  if (!duplicate) {
    const timestamp = options.observedAt.replace(/[:.]/gu, '-');
    await writeJsonAtomic(resolve(root, `${timestamp}-${resultFingerprint.slice(0, 12)}.json`), state);
  }
  return { ...state, path: statePath };
}
