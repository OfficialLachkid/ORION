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
      "policy": "requires_approval",
      "template_key": "video_promotion",
      "recipe_version": "instagram-story-promotion.v1",
      "delay_seconds": 0
    }
  }
}
```

Supported policies are:

- `disabled`: create no Story job;
- `requires_approval`: generate a review-bound asset and require an exact Story approval;
- `auto_publish`: treat the explicit account policy as authorization after the generated asset
  passes validation.

Unknown policy values fail closed. Changing a recipe version creates a distinct deterministic job
identity so an earlier approval cannot authorize revised media.

## Durable dependency

When the shared video approval creates an Instagram Reel child, ORION also creates one deterministic
Story child when the account policy is enabled. The Story starts in
`waiting_source_publication`; it cannot generate or publish until its exact source Reel has a verified
Instagram media receipt.

Planning the dependent row before the external Reel write prevents a restart between Reel
publication and Story dispatch from losing the Story. Story planning or delivery remains isolated
from the Reel result.

## API flow

The shared Graph client supports both `REELS` and `STORIES` containers. A Story container accepts
exactly one public `image_url` or `video_url`, uses the existing bounded processing checks, and is
published through the same `media_publish` endpoint.

The first renderer slice should produce a validated 1080 x 1920 branded JPEG from an existing video
frame or thumbnail. Native Reel-preview stickers, link stickers, and other interactive Story
features are not assumed to be available through the publishing API.

## Rollout state

The adapter and durable policy/job model are prepared, but all existing accounts remain disabled
until the renderer, approval card, executor, and supervised live test are complete.
