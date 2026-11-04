import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptAutomaticCommentTextForPlatform,
  collectAutomaticCommentVariants,
} from '../src/automatic-comment-policy.mjs';

function channelProfile() {
  return {
    metadata: {
      automatic_comments: {
        enabled: true,
        default_variants: [
          { id: 'lower', text: 'subscribe for another battle' },
          { id: 'title', text: 'Subscribe for more Pokemon videos' },
          { id: 'upper', text: 'SUBSCRIBE NOW' },
          { id: 'question', text: 'Which Pokemon should battle next?' },
        ],
      },
    },
  };
}

test('automatic comment wording stays unchanged on YouTube', () => {
  const variants = collectAutomaticCommentVariants({
    channelProfile: channelProfile(),
    platform: 'youtube',
  });
  assert.deepEqual(variants.map((variant) => variant.text), [
    'subscribe for another battle',
    'Subscribe for more Pokemon videos',
    'SUBSCRIBE NOW',
    'Which Pokemon should battle next?',
  ]);
});

test('automatic comment wording changes subscribe to follow for Instagram and TikTok', () => {
  assert.equal(
    adaptAutomaticCommentTextForPlatform('subscribe Subscribe SUBSCRIBE', 'instagram_reels'),
    'follow Follow FOLLOW',
  );
  assert.equal(
    adaptAutomaticCommentTextForPlatform('Subscribe for more', 'tiktok'),
    'Follow for more',
  );
  assert.equal(
    adaptAutomaticCommentTextForPlatform('Which Pokemon should battle next?', 'instagram'),
    'Which Pokemon should battle next?',
  );
});

test('Instagram comment variants keep stable ids after final wording adaptation', () => {
  const variants = collectAutomaticCommentVariants({
    channelProfile: channelProfile(),
    platform: 'instagram',
  });
  assert.deepEqual(variants.map(({ id, text }) => ({ id, text })), [
    { id: 'default-lower', text: 'follow for another battle' },
    { id: 'default-title', text: 'Follow for more Pokemon videos' },
    { id: 'default-upper', text: 'FOLLOW NOW' },
    { id: 'default-question', text: 'Which Pokemon should battle next?' },
  ]);
});
