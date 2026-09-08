import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_GENRE_LABEL,
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  loadVideoTemplateContext,
  resolveVideoTemplateRuntime,
} from '../src/video-template-context.mjs';
import { PRODUCT_VIDEO_TEMPLATE_DEFINITIONS } from '../src/product-video-template-routing.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../../..');

test('pokemon core program registers every shared product-video template option', async () => {
  const program = JSON.parse(await readFile(
    resolve(projectRoot, 'services/product-video-agent/config/programs/pokemon-quiz-core.json'),
    'utf8',
  ));
  const registeredTemplateIds = new Set(
    (Array.isArray(program.templates) ? program.templates : [])
      .map((entry) => String(entry?.template_id || '').trim())
      .filter(Boolean),
  );

  for (const definition of PRODUCT_VIDEO_TEMPLATE_DEFINITIONS) {
    assert.equal(
      registeredTemplateIds.has(definition.templateId),
      true,
      `${definition.templateId} should be registered in pokemon-quiz-core.json`,
    );
  }
});

test('loadVideoTemplateContext resolves the default Poke Quizz ownership stack', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  });

  assert.equal(context.channelConfigPath, DEFAULT_VIDEO_CHANNEL_CONFIG_PATH);
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.stylePackPath, 'services/product-video-agent/config/style-packs/poke-quizz.json');
  assert.equal(context.templatePath, DEFAULT_TEMPLATE_PATH);
  assert.equal(context.templateId, 'pokemon.dual-type-reveal.v1');
  assert.equal(context.publicationChannelSelector, DEFAULT_CHANNEL_SELECTOR);
  assert.equal(context.genreLabel, DEFAULT_GENRE_LABEL);
  assert.equal(context.reviewPresentation.approve_label, 'Publish');
  assert.equal(context.queueStatusPresentation.title, 'Poke Quizz Queue Status');
  assert.equal(
    context.generationProgressPresentation.status_titles.started,
    'Poke Quizz Video Gen - Started',
  );
});

test('resolveVideoTemplateRuntime preserves explicit runtime overrides', async () => {
  const runtime = await resolveVideoTemplateRuntime({
    projectRoot,
    channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
    templatePath: 'services/product-video-agent/pokemon-type-challenge-v1.template.json',
    configPath: 'services/product-video-agent/config.example.json',
    channelSelector: 'custom-channel-selector',
  });

  assert.equal(runtime.channelConfigPath, DEFAULT_VIDEO_CHANNEL_CONFIG_PATH);
  assert.equal(runtime.templatePath, 'services/product-video-agent/pokemon-type-challenge-v1.template.json');
  assert.equal(runtime.configPath, DEFAULT_CONFIG_PATH);
  assert.equal(runtime.channelSelector, 'custom-channel-selector');
  assert.equal(runtime.genreLabel, DEFAULT_GENRE_LABEL);
});

for (const { templatePath, expectedGenreLabel } of [
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
    expectedGenreLabel: 'Find the Shiny',
  },
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/tournament.v1.json',
    expectedGenreLabel: 'Tournament',
  },
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
    expectedGenreLabel: 'Know Your Shiny',
  },
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
    expectedGenreLabel: 'Memory',
  },
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
    expectedGenreLabel: 'Type Quiz',
  },
]) {
  test(`resolveVideoTemplateRuntime remaps manual override ${expectedGenreLabel}`, async () => {
    const runtime = await resolveVideoTemplateRuntime({
      projectRoot,
      channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
      templatePath,
      channelSelector: 'poke-quizz-youtube',
    });

    assert.equal(runtime.templatePath, templatePath);
    assert.equal(runtime.channelSelector, 'poke-quizz-youtube');
    assert.equal(runtime.genreLabel, expectedGenreLabel);
  });
}

for (const {
  label,
  channelConfigPath,
  templateId,
  templatePath,
  channelSelector,
  genreLabel,
} of [
  {
    label: 'Poke Quizz Find the Shiny',
    channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
    templateId: 'pokemon.find-the-shiny.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
    channelSelector: 'poke-quizz-youtube',
    genreLabel: 'Find the Shiny',
  },
  {
    label: 'Poke Quizz Type Quiz',
    channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
    templateId: 'pokemon.type-quiz.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
    channelSelector: 'poke-quizz-youtube',
    genreLabel: 'Type Quiz',
  },
  {
    label: 'TrivaMon Find the Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/trivamon-youtube.json',
    templateId: 'pokemon.find-the-shiny.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
    channelSelector: 'trivamon-youtube',
    genreLabel: 'Find the Shiny',
  },
  {
    label: 'Poke Guess Tournament',
    channelConfigPath: 'services/product-video-agent/config/channels/poke-guess-youtube.json',
    templateId: 'pokemon.tournament.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/tournament.v1.json',
    channelSelector: 'poke-guess-youtube',
    genreLabel: 'Tournament',
  },
  {
    label: 'DexGuess Memory',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-youtube.json',
    templateId: 'pokemon.memory.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Memory',
  },
  {
    label: 'DexGuess Tournament manual selection',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-youtube.json',
    templateId: 'pokemon.tournament.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/tournament.v1.json',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Tournament',
  },
  {
    label: 'Poke Quizz Cry Match',
    channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
    templateId: 'pokemon.cry-match.v1',
    templatePath: 'services/product-video-agent/config/templates/pokemon/cry-match.v1.json',
    channelSelector: 'poke-quizz-youtube',
    genreLabel: 'Cry Match',
  },
]) {
  test(`loadVideoTemplateContext resolves ${label} through the channel template map`, async () => {
    const context = await loadVideoTemplateContext({
      projectRoot,
      channelConfigPath,
      templateId,
    });

    assert.equal(context.channelConfigPath, channelConfigPath);
    assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
    assert.equal(context.templatePath, templatePath);
    assert.equal(context.templateId, templateId);
    assert.equal(context.publicationChannelSelector, channelSelector);
    assert.equal(context.genreLabel, genreLabel);
  });
}

test('loadVideoTemplateContext resolves legacy per-template channel config paths to the base channel config', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/trivamon-youtube.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json');
  assert.equal(context.templateId, 'pokemon.find-the-shiny.v1');
  assert.equal(context.publicationChannelSelector, 'trivamon-youtube');
  assert.equal(context.genreLabel, 'Find the Shiny');
});
