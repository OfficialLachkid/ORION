# Instagram Stories publication

Instagram Story delivery extends the existing Instagram Graph publisher. It does not introduce a
second scheduler, authentication flow, or browser-automation path.

## Policy

Every Instagram target is disabled by default. A target may opt in through its existing
`instagram` configuration:

```json
{
  "instagram": {
    "user_id": "<INSTAGRAM_PROFESSIONAL_ACCOUNT_ID>",
    "expected_username": "<USERNAME>",
    "access_token_env": "<TOKEN_ENV>",
    "story": {
      "enabled": true,
      "template_key": "video_promotion",
      "recipe_version": "instagram-story-promotion.v1",
      "delay_seconds": 0
    }
  }
}
```

Story publishing has no separate approval gate. `enabled: true` is normalized to the
`auto_publish` account policy; an absent or false value is `disabled`. The previously approved
source video plus the versioned account policy authorize the derivative Story.

Unknown policy values fail closed. Changing a recipe version creates a distinct deterministic job
identity so an earlier approval cannot authorize revised media.

## Durable dependency

When the shared video approval creates an Instagram Reel child, ORION also creates one deterministic
Story child when the account policy is enabled. The Story starts in
`waiting_source_publication`; it cannot generate or publish until its exact source Reel has a verified
Instagram media receipt. ORION then renders an eight-second branded 1080 x 1920 MP4 teaser from
the exact hash-verified approved Reel, stages it temporarily, publishes it, records the remote
receipt, and removes the staging object.

Planning the dependent row before the external Reel write prevents a restart between Reel
publication and Story dispatch from losing the Story. Story planning or delivery remains isolated
from the Reel result.

## API flow

The shared Graph client supports both `REELS` and `STORIES` containers. A Story container accepts
exactly one public `image_url` or `video_url`, uses the existing bounded processing checks, and is
published through the same `media_publish` endpoint.

Native Reel-preview stickers, link stickers, and other interactive Story features are not assumed
to be available through the publishing API. The Story therefore contains a branded call to watch
the complete video on the account profile.

## Rollout state

Poke Quizz is the only enabled canary. TrivaMon, Poke Guess, DexGuess, and ProffMon remain disabled
until that canary succeeds. Enabling a later or newly connected Instagram account requires only the
same declarative `instagram.story.enabled` setting; no channel-specific executor code is required.
