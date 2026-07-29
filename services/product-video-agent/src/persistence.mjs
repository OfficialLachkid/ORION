import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveInsideRoot } from './paths.mjs';
import { OutputManifestSchema } from './schemas.mjs';

export class ProductVideoStateStore {
  async saveRun() {
    throw new Error('State stores must implement saveRun().');
  }

  async loadRun() {
    throw new Error('State stores must implement loadRun().');
  }
}

export class FileProductVideoStateStore extends ProductVideoStateStore {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.outputDirectory = options.outputDirectory || 'data/runtime/product-video-agent';
  }

  resolveManifestPath(runId) {
    return resolveInsideRoot(
      this.projectRoot,
      resolve(this.projectRoot, this.outputDirectory, runId, 'manifest.json'),
      'Manifest output path',
    );
  }

  async saveRun(manifest) {
    const parsed = OutputManifestSchema.parse(manifest);
    const manifestPath = this.resolveManifestPath(parsed.run_id);
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return { runId: parsed.run_id, manifestPath, persistence: 'file' };
  }

  async loadRun(runId) {
    const manifestPath = this.resolveManifestPath(runId);
    return OutputManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  }
}

export class SupabaseProductVideoStateStore extends ProductVideoStateStore {
  constructor(options = {}) {
    super();
    this.supabaseUrl = options.supabaseUrl || '';
    this.apiKey = options.apiKey || '';
    this.fetch = options.fetch || globalThis.fetch;
    this.channel = {
      id: options.channel?.id || 'video-channel-product-discovery',
      name: options.channel?.name || 'Product Discovery',
      niche: options.channel?.niche || 'gadgets',
      content_lane: options.channel?.content_lane || 'product-discovery',
      platform: options.channel?.platform || 'multi_platform',
      account_key: options.channel?.account_key || 'product-discovery',
      language: options.channel?.language || 'en-US',
      status: options.channel?.status || 'active',
      settings: options.channel?.settings || {},
    };
    this.accountKeys = options.accountKeys || {};
    this.configured = Boolean(this.supabaseUrl && this.apiKey);
  }

  createHeaders(prefer = '') {
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  createTableUrl(table, query = '') {
    const url = new URL(`/rest/v1/${table}`, this.supabaseUrl);
    if (query) url.search = query;
    return url;
  }

  assertConfigured() {
    if (!this.configured) {
      throw new Error('Supabase video persistence requires a backend URL and secret key.');
    }
    if (typeof this.fetch !== 'function') {
      throw new Error('Supabase video persistence requires fetch support.');
    }
  }

  async request(table, options = {}) {
    this.assertConfigured();
    const response = await this.fetch(
      this.createTableUrl(table, options.query),
      {
        method: options.method || 'GET',
        headers: this.createHeaders(options.prefer),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Supabase ${table} request failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async upsert(table, rows) {
    if (rows.length === 0) return;
    await this.request(table, {
      method: 'POST',
      query: 'on_conflict=id',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: rows,
    });
  }

  buildVideoRow(manifest) {
    const selectedScript = manifest.script_variants.find((script) => (
      script.approval_status === 'approved'
    )) || {};
    const completedAt = manifest.render_jobs.some((job) => job.status === 'complete')
      ? manifest.run_at
      : null;

    return {
      id: manifest.run_id,
      channel_id: this.channel.id,
      title: manifest.products.map((product) => product.canonical_name).join(' + '),
      niche: this.channel.niche,
      content_lane: this.channel.content_lane,
      template_key: manifest.render_jobs[0]?.template_id || '',
      status: manifest.mode,
      subjects: manifest.products,
      source_data: {
        source_snapshots: manifest.source_snapshots,
        media_candidates: manifest.media_candidates,
      },
      score: {
        product_scores: manifest.product_scores,
      },
      scripts: {
        jobs: manifest.script_jobs,
        variants: manifest.script_variants,
        revisions: manifest.script_revisions,
      },
      selected_script: selectedScript,
      voice: {
        license: manifest.voice_license,
        licenses: manifest.voice_licenses,
        jobs: manifest.voice_over_jobs,
      },
      captions: {
        jobs: manifest.caption_jobs,
      },
      render: {
        jobs: manifest.render_jobs,
      },
      approvals: {
        workflow: manifest.workflow_approvals,
        publication: manifest.publication_approvals,
      },
      affiliate_links: manifest.affiliate_links,
      workflow: {
        schema_version: manifest.schema_version,
        run_at: manifest.run_at,
        mode: manifest.mode,
        adapter: manifest.adapter,
        content_strategy: manifest.content_strategy,
        gates: manifest.gates,
        external_calls: manifest.external_calls,
        notes: manifest.notes,
      },
      archive: {
        render_results: manifest.archive_results,
        asset_storage_locations: manifest.asset_storage_locations,
      },
      cost: manifest.cost,
      last_error: null,
      completed_at: completedAt,
    };
  }

  buildAssetRows(manifest) {
    return manifest.assets.map((asset) => ({
      id: asset.asset_id,
      video_id: manifest.run_id,
      subject_id: asset.product_id,
      kind: asset.source_provider.includes('generated') ? 'generated' : 'source',
      media_type: asset.media_type,
      source_url: asset.source_url,
      content_sha256: asset.content_sha256,
      rights_status: asset.rights_status,
      approval_status: asset.approval_status,
      provenance: asset,
      storage: manifest.asset_storage_locations.filter((location) => (
        location.asset_id === asset.asset_id
      )),
      metadata: {
        download_status: asset.download_status,
        usage_scope: asset.usage_scope,
        usage_notes: asset.usage_notes,
      },
    }));
  }

  buildPublicationRows(manifest) {
    const approvedVariants = manifest.script_variants.filter((variant) => (
      variant.approval_status === 'approved'
    ));
    const selectedScriptJobIds = new Set(manifest.script_jobs.filter((job) => (
      approvedVariants.some((variant) => (
        variant.product_id === job.product_id && variant.angle === job.angle
      ))
    )).map((job) => job.script_job_id));
    const publications = selectedScriptJobIds.size > 0
      ? manifest.publications.filter((publication) => (
          selectedScriptJobIds.has(publication.script_job_id)
        ))
      : manifest.publications;

    return publications.map((publication) => ({
      id: publication.publication_id,
      video_id: manifest.run_id,
      platform: publication.platform,
      account_key: this.accountKeys[publication.platform] || publication.platform,
      status: publication.status,
      visibility: 'private',
      title: publication.title,
      description: publication.description,
      hashtags: publication.hashtags,
      disclosure: publication.affiliate_disclosure,
      scheduled_for: publication.scheduled_at,
      uploaded_at: null,
      published_at: publication.published_at,
      external_id: publication.external_post_id,
      metadata: {
        approval_id: publication.approval_id,
        script_job_id: publication.script_job_id,
        thumbnail_asset_id: publication.thumbnail_asset_id,
        affiliate_link_id: publication.affiliate_link_id,
        manifest_publication: publication,
      },
    }));
  }

  async saveRun(manifest) {
    const parsed = OutputManifestSchema.parse(manifest);
    const assets = this.buildAssetRows(parsed);
    const publications = this.buildPublicationRows(parsed);

    await this.upsert('video_channels', [this.channel]);
    await this.upsert('videos', [this.buildVideoRow(parsed)]);
    await this.upsert('video_assets', assets);
    await this.upsert('video_publications', publications);

    return {
      runId: parsed.run_id,
      persistence: 'supabase',
      tables: {
        video_channels: 1,
        videos: 1,
        video_assets: assets.length,
        video_publications: publications.length,
        video_analytics: 0,
      },
    };
  }

  async loadRun(runId) {
    const [videoRows, assetRows, publicationRows] = await Promise.all([
      this.request('videos', { query: `id=eq.${encodeURIComponent(runId)}&select=*` }),
      this.request('video_assets', { query: `video_id=eq.${encodeURIComponent(runId)}&select=*` }),
      this.request('video_publications', { query: `video_id=eq.${encodeURIComponent(runId)}&select=*` }),
    ]);
    const video = videoRows?.[0];
    if (!video) throw new Error(`Supabase video run not found: ${runId}`);
    const workflow = video.workflow;

    return OutputManifestSchema.parse({
      schema_version: workflow.schema_version,
      run_id: video.id,
      run_at: workflow.run_at,
      mode: workflow.mode,
      adapter: workflow.adapter,
      content_strategy: workflow.content_strategy,
      products: video.subjects,
      source_snapshots: video.source_data.source_snapshots,
      media_candidates: video.source_data.media_candidates,
      product_scores: video.score.product_scores,
      assets: assetRows.map((row) => row.provenance),
      asset_acquisition_plans: [],
      script_jobs: video.scripts.jobs,
      script_variants: video.scripts.variants,
      script_revisions: video.scripts.revisions,
      voice_license: video.voice.license,
      voice_licenses: video.voice.licenses,
      voice_over_jobs: video.voice.jobs,
      caption_jobs: video.captions.jobs,
      render_jobs: video.render.jobs,
      workflow_approvals: video.approvals.workflow,
      affiliate_links: video.affiliate_links,
      publication_approvals: video.approvals.publication,
      publications: publicationRows.map((row) => row.metadata.manifest_publication),
      analytics_snapshots: [],
      archive_results: video.archive.render_results,
      asset_storage_locations: video.archive.asset_storage_locations,
      gates: workflow.gates,
      external_calls: workflow.external_calls,
      cost: video.cost,
      notes: workflow.notes,
    });
  }
}
