import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { planUltimatePokemonQuiz } from '../src/domains/pokemon/long-form/ultimate-quiz/planner.mjs';
import { buildUltimateQuizRenderPlan } from '../src/domains/pokemon/long-form/ultimate-quiz/render-plan.mjs';
import { buildLandscapeBackgroundCatalog } from '../src/domains/pokemon/long-form/media-catalog.mjs';
import { createPokeQuizzPublicationRegistration } from '../src/poke-quizz-publication-registration.mjs';
import { buildYoutubeVideoUrl } from '../src/youtube-publication-executor.mjs';
import { syncYoutubeAutoCommentState } from '../src/youtube-auto-comments.mjs';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDirectory, '../../..');

async function loadTemplate() {
  const filePath = resolve(
    projectRoot,
    'services/product-video-agent/config/templates/pokemon/long/ultimate-quiz.v1.json',
  );
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function buildRows(root, count = 60) {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `pokemon-${number}`,
      national_dex_number: number,
      name: `Pokemon ${number}`,
      slug: `pokemon-${number}`,
      generation: Math.min(9, Math.ceil(number / 7)),
      region: 'fixture',
      types: number % 2 === 0 ? ['water'] : ['fire', 'flying'],
      sprite_path: join(root, `sprite-${number}.png`),
      cry_path: join(root, `cry-${number}.ogg`),
      metadata: { pokemon_api: { is_default_form: true } },
    };
  });
}

test('Ultimate Pokemon Quiz plans a deterministic native 16:9 episode over eight minutes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-long-form-'));
  const rows = buildRows(root);
  await Promise.all(rows.map((row) => writeFile(row.cry_path, 'fixture')));
  const template = await loadTemplate();
  const inventory = {
    music: ['/music/one.mp3', '/music/two.mp3', '/music/three.mp3', '/music/four.mp3'],
    sound_effects: { ding: '/sfx/ding.mp3' },
    directories: { previews: '/previews' },
  };
  const landscapeBackgrounds = [1, 2, 3, 4].map((number) => ({
    path: `/backgrounds/${number}.png`,
    width: 1920,
    height: 1080,
    aspect_ratio: 1.7778,
    orientation: 'landscape',
  }));
  const options = {
    template,
    pokedexRows: rows,
    seed: 'long-form-seed-1',
    channelProfile: { id: 'channel-1', name: 'Poke Quizz', account_key: 'poke-quizz-youtube' },
    inventory,
    landscapeBackgrounds,
  };
  const first = await planUltimatePokemonQuiz(options);
  const second = await planUltimatePokemonQuiz(options);

  assert.equal(first.content_format, 'long_form');
  assert.equal(first.content_surface, 'youtube_watch');
  assert.deepEqual(first.media_profile, {
    width: 1920,
    height: 1080,
    fps: 30,
    aspect_ratio: '16:9',
  });
  assert.equal(first.rounds.length, 24);
  assert.equal(first.chapters.length, 3);
  assert.ok(first.timing.total_duration_seconds >= 480);
  assert.equal(first.timing.total_duration_seconds, 487);
  assert.equal(new Set(first.rounds.map((round) => round.subject.slug)).size, 24);
  assert.deepEqual(first.rounds, second.rounds);
  assert.deepEqual(first.assets.backgrounds, second.assets.backgrounds);
  assert.equal(first.publication_policy.related_video_enabled, false);

  const renderPlan = buildUltimateQuizRenderPlan({ plan: first, template, outputPath: '/tmp/out.mp4' });
  assert.equal(renderPlan.canvas.width, 1920);
  assert.equal(renderPlan.canvas.height, 1080);
  assert.equal(renderPlan.total_duration_seconds, 487);
});

test('landscape catalog excludes portrait, square, small, and overly narrow media', async () => {
  const dimensions = new Map([
    ['/wide.png', [1920, 1080]],
    ['/portrait.png', [1080, 1920]],
    ['/square.png', [1200, 1200]],
    ['/small.png', [960, 540]],
    ['/narrow.png', [1400, 1100]],
  ]);
  const runProcess = async ({ args }) => {
    const filePath = args.at(-1);
    const [width, height] = dimensions.get(filePath);
    return {
      stdout: JSON.stringify({ streams: [{ width, height }], format: {} }),
      stderr: '',
      code: 0,
    };
  };
  const result = await buildLandscapeBackgroundCatalog({
    filePaths: [...dimensions.keys()],
    ffmpegExecutable: '/tools/ffmpeg',
    cwd: projectRoot,
    runProcess,
  });
  assert.deepEqual(result.eligible.map((entry) => entry.path), ['/wide.png']);
});

test('long-form registration preserves watch-page semantics without changing Shorts defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-long-registration-'));
  const renderPath = join(root, 'episode.mp4');
  await writeFile(renderPath, 'render');
  const plan = {
    schema_version: 'pokemon-long-form-plan-v1',
    template_id: 'pokemon.long.ultimate-quiz.v1',
    seed: 'registration-seed',
    content_format: 'long_form',
    content_surface: 'youtube_watch',
    media_profile: { width: 1920, height: 1080, fps: 30, aspect_ratio: '16:9' },
    timing: { total_duration_seconds: 487 },
    selection: { selected_subjects: [{ name: 'Pikachu' }] },
    publication_policy: { related_video_enabled: false },
  };
  const channelProfile = {
    id: 'channel-1',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    niche: 'pokemon',
    content_lane: 'poke-quizz',
    workflow: { preview_visibility: 'unlisted' },
  };
  const result = await createPokeQuizzPublicationRegistration({
    plan,
    channelProfile,
    renderPath,
    metadata: {
      title: 'Long quiz',
      description: 'Description',
      hashtags: ['pokemon'],
      generation_provider: 'template',
    },
  });
  assert.equal(result.videoRow.workflow.content_strategy.primary, 'long_form');
  assert.deepEqual(result.videoRow.workflow.content_strategy.platforms, ['youtube_watch']);
  assert.equal(result.publicationRow.metadata.content_surface, 'youtube_watch');
  assert.equal(result.videoRow.render.duration_seconds, 487);
  assert.equal(buildYoutubeVideoUrl('abc', 'youtube_watch'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(buildYoutubeVideoUrl('abc'), 'https://youtube.com/shorts/abc');
});

test('watch-page publications do not inherit channel-level Shorts auto comments', async () => {
  let posted = false;
  const publication = {
    id: 'pub-long',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    external_id: 'youtube-long-1',
    metadata: {
      content_surface: 'youtube_watch',
      publication_policy: { auto_comment_enabled: false },
    },
  };
  const store = {
    async updatePublication(_id, patch) {
      return { ...publication, ...patch, metadata: patch.metadata };
    },
  };
  const result = await syncYoutubeAutoCommentState({
    store,
    publication,
    channelProfile: {
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
      metadata: {
        youtube_auto_comment: {
          enabled: true,
          variants: ['What was your score?'],
        },
      },
    },
    postYoutubeTopLevelCommentImpl: async () => {
      posted = true;
      return {};
    },
  });
  assert.equal(result.action, 'disabled');
  assert.equal(result.reason, 'content_surface_not_youtube_shorts');
  assert.equal(posted, false);
});
