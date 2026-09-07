# Multi-Platform Publication

This is the phase-1 structure for publishing an already approved ORION short to additional platforms.

## Current Flow

YouTube remains the review and preview surface.

1. A rendered video is uploaded to YouTube as the preview/review copy.
2. Discord approval schedules the YouTube publication as before.
3. The approval flow fans out additional `video_publications` rows for enabled social targets in the source channel profile.
4. The publication scheduler uploads due social rows when their `scheduled_for` time is reached.

This keeps the Discord approval/reject flow unchanged. Extra platforms are records linked to the same `videos` row, not duplicated video jobs.

## TikTok V1

TikTok uses the official Content Posting API shape with local `FILE_UPLOAD`.

- No hosted storage bucket is introduced.
- ORION schedules locally by holding a `tiktok_video` publication row until it is due.
- Unaudited TikTok apps should use `SELF_ONLY` privacy. Public posting requires TikTok app review approval.
- Missing tokens fail closed into `auth_required`; YouTube scheduling is not rolled back.

## Script Layout

Real implementation scripts should live under their domain/platform folders:

- `services/product-video-agent/scripts/publication/social/tiktok/execute-due-publications.mjs`

Stable compatibility wrappers can remain above that level when old automation might still call them:

- `services/product-video-agent/scripts/publication/social/execute-due-publications.mjs`
- `services/product-video-agent/scripts/publication/execute-social-publication.mjs`

Avoid adding new platform implementation scripts directly under `services/product-video-agent/scripts/`.

## Channel Target Config

Add enabled targets under a YouTube channel profile:

```json
{
  "metadata": {
    "publisher": {
      "targets": [
        {
          "platform": "tiktok_video",
          "account_key": "poke-quizz-tiktok",
          "enabled": true,
          "schedule_mode": "orion",
          "visibility": "private",
          "tiktok": {
            "access_token_env": "TIKTOK_POKE_QUIZZ_ACCESS_TOKEN",
            "privacy_level": "SELF_ONLY",
            "comments_enabled": true,
            "duet_enabled": false,
            "stitch_enabled": false
          }
        }
      ]
    }
  }
}
```

Keep `enabled` false until the TikTok app and token are ready.

