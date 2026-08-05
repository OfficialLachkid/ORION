import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyYoutubeRelatedVideoSelection,
  buildStudioEditUrl,
  buildYoutubeRelatedVideoRunCode,
  probeYoutubeRelatedVideoCapability,
  resolveYoutubeRelatedVideoAutomationSettings,
} from '../../src/related-video/youtube-studio-automation.mjs';

const channelProfile = {
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  youtube: {
    channel_id: 'UC-POKE-QUIZZ',
  },
  metadata: {
    related_video: {
      enabled: true,
      provider: 'youtube_studio',
      browser: 'chrome',
      profile_dir: '/Users/Agent/.orion/playwright-profile',
      session_name: 'yt-related-poke-quizz',
    },
  },
};

const publication = {
  external_id: 'yt-target',
};

const relatedVideo = {
  selection_status: 'planned',
  target_external_id: 'yt-related',
  target_title: 'Guess the Pokemon: Bug / Ground',
  target_url: 'https://youtube.com/shorts/yt-related',
};

test('related-video automation resolves channel settings from metadata', () => {
  const settings = resolveYoutubeRelatedVideoAutomationSettings(channelProfile);

  assert.equal(settings.enabled, true);
  assert.equal(settings.provider, 'youtube_studio');
  assert.equal(settings.profileDir, '/Users/Agent/.orion/playwright-profile');
  assert.equal(settings.sessionName, 'yt-related-poke-quizz');
});

test('related-video capability probe refuses channels without a configured profile', () => {
  const capability = probeYoutubeRelatedVideoCapability({
    channelProfile: {
      ...channelProfile,
      metadata: {
        related_video: {
          ...channelProfile.metadata.related_video,
          profile_dir: '',
        },
      },
    },
    publication,
    relatedVideo,
    fsExists: () => false,
  });

  assert.equal(capability.status, 'profile_not_configured');
  assert.equal(capability.canAttempt, false);
});

test('related-video apply short-circuits cleanly when automation is disabled', async () => {
  const result = await applyYoutubeRelatedVideoSelection({
    channelProfile: {
      ...channelProfile,
      metadata: {
        related_video: {
          ...channelProfile.metadata.related_video,
          enabled: false,
        },
      },
    },
    publication,
    relatedVideo,
    fsExists: () => true,
  });

  assert.equal(result.applyStatus, 'skipped');
  assert.equal(result.capability.status, 'disabled');
  assert.match(result.lastError, /disabled/u);
});

test('related-video run-code script includes the selected target title', () => {
  const code = buildYoutubeRelatedVideoRunCode(relatedVideo);

  assert.match(code, /Guess the Pokemon: Bug \/ Ground/u);
  assert.match(code, /related video/i);
  assert.match(code, /save/i);
});

test('buildStudioEditUrl forces the English UI so button-name selectors match regardless of account locale', () => {
  const url = buildStudioEditUrl('yt-target');

  assert.match(url, /studio\.youtube\.com\/video\/yt-target\/edit/u);
  assert.match(url, /\?hl=en/u);
});

test('buildStudioEditUrl returns empty string for a missing external id', () => {
  assert.equal(buildStudioEditUrl(''), '');
  assert.equal(buildStudioEditUrl(null), '');
  assert.equal(buildStudioEditUrl(undefined), '');
});
