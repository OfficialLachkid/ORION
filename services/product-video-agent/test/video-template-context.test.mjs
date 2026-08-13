import test from 'node:test';
import assert from 'node:assert/strict';
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

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../../..');

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

test('loadVideoTemplateContext resolves the dedicated Find the Shiny channel config', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/poke-quizz-find-the-shiny-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/poke-quizz-find-the-shiny-youtube.json');
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json');
  assert.equal(context.templateId, 'pokemon.find-the-shiny.v1');
  assert.equal(context.publicationChannelSelector, DEFAULT_CHANNEL_SELECTOR);
  assert.equal(context.genreLabel, 'Find the Shiny');
});

test('loadVideoTemplateContext resolves the TrivaMon Find the Shiny ownership stack', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json');
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json');
  assert.equal(context.templateId, 'pokemon.find-the-shiny.v1');
  assert.equal(context.publicationChannelSelector, 'trivamon-youtube');
  assert.equal(context.genreLabel, 'Find the Shiny');
});

test('loadVideoTemplateContext resolves the dedicated Type Quiz channel config', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/poke-quizz-type-speed-quiz-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/poke-quizz-type-speed-quiz-youtube.json');
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json');
  assert.equal(context.templateId, 'pokemon.type-quiz.v1');
  assert.equal(context.publicationChannelSelector, DEFAULT_CHANNEL_SELECTOR);
  assert.equal(context.genreLabel, 'Type Quiz');
});

test('loadVideoTemplateContext resolves the TrivaMon Type Quiz ownership stack', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/trivamon-type-speed-quiz-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/trivamon-type-speed-quiz-youtube.json');
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json');
  assert.equal(context.templateId, 'pokemon.type-quiz.v1');
  assert.equal(context.publicationChannelSelector, 'trivamon-youtube');
  assert.equal(context.genreLabel, 'Type Quiz');
});

test('loadVideoTemplateContext resolves the Poke Guess Type Quiz ownership stack', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/poke-guess-type-speed-quiz-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/poke-guess-type-speed-quiz-youtube.json');
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json');
  assert.equal(context.templateId, 'pokemon.type-quiz.v1');
  assert.equal(context.publicationChannelSelector, 'poke-guess-youtube');
  assert.equal(context.genreLabel, 'Type Quiz');
});

test('loadVideoTemplateContext resolves the DexGuess dual-type ownership stack', async () => {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-youtube.json',
  });

  assert.equal(context.channelConfigPath, 'services/product-video-agent/config/channels/dexguess-youtube.json');
  assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
  assert.equal(context.templatePath, 'services/product-video-agent/config/templates/pokemon/dual-type-reveal.v1.json');
  assert.equal(context.templateId, 'pokemon.dual-type-reveal.v1');
  assert.equal(context.publicationChannelSelector, 'dexguess-youtube');
  assert.equal(context.genreLabel, 'Type Combination');
});
