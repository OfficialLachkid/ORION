import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export const DEFAULT_PUBLICATION_STAGING_BUCKET = 'orion-publication-staging';
export const DEFAULT_PUBLICATION_STAGING_MAX_BYTES = 50_000_000;
const ALLOWED_MIME_TYPES = ['video/mp4'];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeObjectPath(value) {
  const path = normalizeText(value).replace(/^\/+|\/+$/gu, '');
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Supabase staging requires a safe, non-empty object path.');
  }
  return segments.join('/');
}

function encodeObjectPath(value) {
  return normalizeObjectPath(value)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function safePathSegment(value, fallback = 'publication') {
  const segment = normalizeText(value)
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return segment || fallback;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorDetail(payload) {
  if (typeof payload === 'string') return payload;
  return normalizeText(payload?.message || payload?.error || payload?.msg || JSON.stringify(payload || {}));
}

export class SupabasePublicationStaging {
  constructor(options = {}) {
    this.supabaseUrl = normalizeText(options.supabaseUrl).replace(/\/+$/u, '');
    this.apiKey = normalizeText(options.apiKey);
    this.bucketName = normalizeText(options.bucketName) || DEFAULT_PUBLICATION_STAGING_BUCKET;
    this.maxFileBytes = Number(options.maxFileBytes || DEFAULT_PUBLICATION_STAGING_MAX_BYTES);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.statImpl = options.statImpl || stat;
    this.createReadStreamImpl = options.createReadStreamImpl || createReadStream;
    this.uuidImpl = options.uuidImpl || randomUUID;
  }

  assertConfigured() {
    if (!this.supabaseUrl || !this.apiKey) {
      throw new Error('Supabase publication staging requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Supabase publication staging requires fetch support.');
    }
    if (!Number.isFinite(this.maxFileBytes) || this.maxFileBytes <= 0) {
      throw new Error('Supabase publication staging requires a positive maximum file size.');
    }
  }

  storageUrl(pathname) {
    return new URL(`/storage/v1/${String(pathname).replace(/^\/+/, '')}`, this.supabaseUrl);
  }

  authHeaders(extra = {}) {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  async request(pathname, options = {}) {
    this.assertConfigured();
    const response = await this.fetchImpl(this.storageUrl(pathname), {
      method: options.method || 'GET',
      headers: this.authHeaders(options.headers),
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.duplex ? { duplex: options.duplex } : {}),
    });
    const payload = await readResponse(response);
    if (!response.ok) {
      const error = new Error(
        `Supabase Storage request failed (${response.status}): ${errorDetail(payload).slice(0, 500)}`,
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async inspectBucket() {
    try {
      return await this.request(`bucket/${encodeURIComponent(this.bucketName)}`);
    } catch (error) {
      const missingBucket = error?.status === 404
        || (
          error?.status === 400
          && /bucket\s+not\s+found/iu.test(errorDetail(error?.payload))
        );
      if (missingBucket) return null;
      throw error;
    }
  }

  async provisionBucket() {
    const existing = await this.inspectBucket();
    if (existing) {
      const allowedMimeTypes = Array.isArray(existing.allowed_mime_types)
        ? existing.allowed_mime_types
        : [];
      if (existing.public !== true || !allowedMimeTypes.includes('video/mp4')) {
        throw new Error(
          `Existing Supabase bucket ${this.bucketName} does not match the required public MP4-only configuration.`,
        );
      }
      return { created: false, bucket: existing };
    }

    const bucket = await this.request('bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.bucketName,
        name: this.bucketName,
        public: true,
        file_size_limit: this.maxFileBytes,
        allowed_mime_types: ALLOWED_MIME_TYPES,
      }),
    });
    return { created: true, bucket };
  }

  buildObjectPath(publicationId, pathPrefix = 'buffer') {
    return `${safePathSegment(pathPrefix, 'publication')}/${safePathSegment(publicationId)}--${safePathSegment(this.uuidImpl(), 'object')}.mp4`;
  }

  getPublicUrl(objectPath) {
    const encodedBucket = encodeURIComponent(this.bucketName);
    return String(this.storageUrl(`object/public/${encodedBucket}/${encodeObjectPath(objectPath)}`));
  }

  async stageFile({ publicationId, filePath, objectPath = '', pathPrefix = 'buffer' }) {
    this.assertConfigured();
    const normalizedFilePath = normalizeText(filePath);
    if (!normalizedFilePath) {
      throw new Error('Supabase publication staging requires an MP4 file path.');
    }
    const fileStats = await this.statImpl(normalizedFilePath);
    const sizeBytes = Number(fileStats?.size || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new Error(`Cannot stage an empty publication file: ${normalizedFilePath}`);
    }
    if (sizeBytes > this.maxFileBytes) {
      throw new Error(
        `Publication file ${sizeBytes} bytes exceeds the staging limit of ${this.maxFileBytes} bytes.`,
      );
    }

    const finalObjectPath = normalizeObjectPath(
      objectPath || this.buildObjectPath(publicationId, pathPrefix),
    );
    const body = this.createReadStreamImpl(normalizedFilePath);
    const isStream = body && typeof body === 'object' && typeof body.pipe === 'function';
    await this.request(
      `object/${encodeURIComponent(this.bucketName)}/${encodeObjectPath(finalObjectPath)}`,
      {
        method: 'POST',
        headers: {
          'cache-control': 'max-age=60',
          'content-type': 'video/mp4',
          'x-upsert': 'false',
        },
        body,
        ...(isStream ? { duplex: 'half' } : {}),
      },
    );

    return {
      bucketName: this.bucketName,
      objectPath: finalObjectPath,
      publicUrl: this.getPublicUrl(finalObjectPath),
      sizeBytes,
    };
  }

  async verifyPublicObject(publicUrl) {
    const response = await this.fetchImpl(publicUrl, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`Staged publication URL is not publicly reachable (${response.status}).`);
    }
    return { reachable: true, status: response.status };
  }

  async removeObject(objectPath) {
    const normalizedPath = normalizeObjectPath(objectPath);
    await this.request(`object/${encodeURIComponent(this.bucketName)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [normalizedPath] }),
    });
    return { removed: true, objectPath: normalizedPath };
  }

  async listObjects(prefix = 'buffer') {
    const normalizedPrefix = normalizeObjectPath(prefix);
    const payload = await this.request(`object/list/${encodeURIComponent(this.bucketName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix: normalizedPrefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: 'created_at', order: 'asc' },
      }),
    });
    return Array.isArray(payload) ? payload : [];
  }

  async cleanupStaleObjects({ prefix = 'buffer', olderThan, protectedPaths = [] }) {
    const cutoff = new Date(olderThan);
    if (Number.isNaN(cutoff.getTime())) {
      throw new Error('Supabase staging cleanup requires a valid olderThan timestamp.');
    }
    const normalizedPrefix = normalizeObjectPath(prefix);
    const protectedSet = new Set(protectedPaths.map((path) => normalizeObjectPath(path)));
    const objects = await this.listObjects(normalizedPrefix);
    const removedPaths = [];
    for (const object of objects) {
      const createdAt = new Date(object.created_at || object.updated_at || '');
      if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() >= cutoff.getTime()) continue;
      const name = normalizeText(object.name);
      if (!name) continue;
      const objectPath = name.startsWith(`${normalizedPrefix}/`)
        ? name
        : `${normalizedPrefix}/${name}`;
      if (protectedSet.has(objectPath)) continue;
      await this.removeObject(objectPath);
      removedPaths.push(objectPath);
    }
    return { removedPaths, scannedCount: objects.length };
  }
}
