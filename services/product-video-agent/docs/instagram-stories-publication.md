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
      "template_key": "variant_rotation",
      "recipe_version": "instagram-story-promotion.v2",
      "display_name": "Poke Quizz",
      "theme": {
        "primary": "#FFCB05",
        "secondary": "#1756B8",
        "accent": "#E3350D",
        "surface": "#071B3A",
        "text": "#FFFFFF"
      },
      "avatar_cache_ttl_hours": 168,
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

## Continuation cadence

The normal publication worker creates the Story child and starts delivery after its source Reel is
verified. Meta may still be processing the Story container when that worker finishes. A dedicated
LaunchAgent therefore runs the lightweight Story executor 20 minutes after each publication slot
belonging to an active Story-enabled profile. It resumes persisted containers instead of creating
duplicates.

This continuation does not start the complete YouTube or social publication scheduler and does not
load a model. It reads only active Story rows plus their compact source receipts. Profiles without
Story publishing enabled add no wake times; newly enabled profiles inherit their own schedule slots
when the publication LaunchAgents are installed again.

## Variant rotation and account identity

The version 2 recipe set currently contains eight reusable layouts: the original presentation,
branded full-screen, framed card, minimal, hybrid, glass spotlight, editorial gallery, and broadcast
elite. Each account advances through a deterministic shuffle bag. Every registered layout is used
exactly once before the next cycle, and a new cycle is adjusted when necessary so it cannot start
with the layout that ended the previous cycle. The chosen `variant_key`, pool signature, cycle,
position, and cycle order are stored on the durable Story child. Retries and restart recovery
therefore reproduce the same media rather than selecting a different layout.

Layout names are internal operational identifiers, not audience-facing marketing copy. Rendered
Stories use direct labels such as `NEW VIDEO` and never describe the Story or template as premium.

Every recipe uses the configured Instagram account's own profile image. The renderer requests
`profile_picture_url` only after matching both the returned publishing user id and username to the
target. It normalizes and caches that image locally for seven days by default. The seven-day value is
a refresh interval, not an expiry: daily Stories reuse the cached PNG, and the first render after the
interval attempts to refresh it. A stale cache remains usable during a temporary Meta outage; when
no verified cache exists, a neutral profile silhouette is used. Hardcoded channel initials are never
rendered, and profile icons do not need to be duplicated in the repository.

The default pool is derived directly from the renderer registry. Adding a renderer definition to
that registry automatically makes the template available to every account that inherits the default
pool; there is no second allowlist or per-channel edit. Per-account `variant_keys` may deliberately
restrict the pool, but should be omitted for accounts that should inherit future templates. Color
themes remain account-specific without adding channel-specific executor code.

## API flow

The shared Graph client supports both `REELS` and `STORIES` containers. A Story container accepts
exactly one public `image_url` or `video_url`, uses the existing bounded processing checks, and is
published through the same `media_publish` endpoint.

Native Reel-preview stickers, link stickers, and other interactive Story features are not assumed
to be available through the publishing API. The Story therefore contains a branded call to watch
the complete video on the account profile.

## Rollout state

Poke Quizz and TrivaMon completed the canary period successfully. Stories are now enabled for all
five owned Instagram accounts: Poke Quizz, TrivaMon, Poke Guess, DexGuess, and ProffMon. A later or
newly connected Instagram account requires only the same declarative `instagram.story.enabled`
setting; it automatically inherits the reusable recipe registry and its own identity-verified
profile image without channel-specific executor code.

When an account is enabled after its Reels have already been approved or scheduled, run a targeted
idempotent reconciliation for those future Instagram publication rows after deployment. New Story
children are then created from the current account policy without changing the existing Reel
schedule or producing duplicate Stories. Newly planned videos inherit the policy automatically.
