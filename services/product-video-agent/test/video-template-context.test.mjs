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

test('resolveVideoTemplateRuntime remaps genre when a manual template override switches flows', async () => {
  const runtime = await resolveVideoTemplateRuntime({
    projectRoot,
    channelConfigPath: DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
    templatePath: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
    channelSelector: 'poke-quizz-youtube',
  });

  assert.equal(runtime.templatePath, 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json');
  assert.equal(runtime.channelSelector, 'poke-quizz-youtube');
  assert.equal(runtime.genreLabel, 'Know Your Shiny');
});

for (const { templatePath, expectedGenreLabel } of [
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
    expectedGenreLabel: 'Find the Shiny',
  },
  {
    templatePath: 'services/product-video-agent/config/templates/pokemon/showdown.v1.json',
    expectedGenreLabel: 'Showdown',
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

for (const {
  label,
  channelConfigPath,
  templatePath,
  templateId,
  channelSelector,
  genreLabel,
} of [
  {
    label: 'DexGuess Showdown',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-showdown-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/showdown.v1.json',
    templateId: 'pokemon.showdown.v1',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Showdown',
  },
  {
    label: 'Poke Quizz Memory',
    channelConfigPath: 'services/product-video-agent/config/channels/poke-quizz-memory-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
    templateId: 'pokemon.memory.v1',
    channelSelector: 'poke-quizz-youtube',
    genreLabel: 'Memory',
  },
  {
    label: 'TrivaMon Memory',
    channelConfigPath: 'services/product-video-agent/config/channels/trivamon-memory-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
    templateId: 'pokemon.memory.v1',
    channelSelector: 'trivamon-youtube',
    genreLabel: 'Memory',
  },
  {
    label: 'Poke Guess Memory',
    channelConfigPath: 'services/product-video-agent/config/channels/poke-guess-memory-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
    templateId: 'pokemon.memory.v1',
    channelSelector: 'poke-guess-youtube',
    genreLabel: 'Memory',
  },
  {
    label: 'DexGuess Memory',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-memory-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/memory.v1.json',
    templateId: 'pokemon.memory.v1',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Memory',
  },
  {
    label: 'Poke Quizz Know Your Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/poke-quizz-know-your-shiny-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
    templateId: 'pokemon.know-your-shiny.v1',
    channelSelector: 'poke-quizz-youtube',
    genreLabel: 'Know Your Shiny',
  },
  {
    label: 'TrivaMon Know Your Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/trivamon-know-your-shiny-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
    templateId: 'pokemon.know-your-shiny.v1',
    channelSelector: 'trivamon-youtube',
    genreLabel: 'Know Your Shiny',
  },
  {
    label: 'Poke Guess Know Your Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/poke-guess-know-your-shiny-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
    templateId: 'pokemon.know-your-shiny.v1',
    channelSelector: 'poke-guess-youtube',
    genreLabel: 'Know Your Shiny',
  },
  {
    label: 'DexGuess Know Your Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-know-your-shiny-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/know-your-shiny.v1.json',
    templateId: 'pokemon.know-your-shiny.v1',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Know Your Shiny',
  },
  {
    label: 'Poke Guess Find the Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/poke-guess-find-the-shiny-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
    templateId: 'pokemon.find-the-shiny.v1',
    channelSelector: 'poke-guess-youtube',
    genreLabel: 'Find the Shiny',
  },
  {
    label: 'DexGuess Find the Shiny',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-find-the-shiny-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
    templateId: 'pokemon.find-the-shiny.v1',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Find the Shiny',
  },
  {
    label: 'DexGuess Type Quiz',
    channelConfigPath: 'services/product-video-agent/config/channels/dexguess-type-speed-quiz-youtube.json',
    templatePath: 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
    templateId: 'pokemon.type-quiz.v1',
    channelSelector: 'dexguess-youtube',
    genreLabel: 'Type Quiz',
  },
]) {
  test(`loadVideoTemplateContext resolves the ${label} ownership stack`, async () => {
    const context = await loadVideoTemplateContext({
      projectRoot,
      channelConfigPath,
    });

    assert.equal(context.channelConfigPath, channelConfigPath);
    assert.equal(context.programPath, 'services/product-video-agent/config/programs/pokemon-quiz-core.json');
    assert.equal(context.templatePath, templatePath);
    assert.equal(context.templateId, templateId);
    assert.equal(context.publicationChannelSelector, channelSelector);
    assert.equal(context.genreLabel, genreLabel);
  });
}
