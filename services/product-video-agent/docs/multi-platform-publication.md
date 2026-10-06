# Multi-Platform Publication

This is the phase-1 structure for publishing an already approved ORION short to additional platforms.

## Status (2026-10-06)

- Tracking issue: [#95 — ORION Multi-Platform Social Publisher, Phase 1: TikTok](https://github.com/OfficialLachkid/ORION/issues/95)
- Implementation PR: [#97 — scaffold TikTok social publisher](https://github.com/OfficialLachkid/ORION/pull/97)
- State: the code scaffold is implemented and tested, but no live TikTok account is connected and the target remains disabled.
- The PR branch has been brought forward to current `main`; the scheduler conflict was resolved by retaining current per-channel error isolation and adding isolated social-publication execution.
- The original Runtime Validation failure was only `git diff --check`: this file and `src/tiktok-publication-executor.mjs` had an extra blank line at EOF. Both are fixed.
- Local verification on 2026-10-06: runtime-config validation passed, the product-video suite passed (454 passed, 1 skipped), the Discord/runtime suite passed (369 passed), and the focused TikTok/scheduler/task-router suite passed (31 passed).

This is not production-ready yet. A TikTok account and developer app are required, but reliable Mac mini scheduling also needs OAuth refresh-token handling, creator-capability checks, idempotent execution, and an operator retry path before any target is enabled.

## Implemented

- Generic additional-target discovery from a source channel profile.
- Deterministic, idempotent sibling `video_publications` rows linked to the same `videos` row.
- Fan-out after the approved YouTube publication receives a schedule slot; a fan-out failure does not roll back YouTube.
- A TikTok `FILE_UPLOAD` client for Direct Post initialization and chunked MP4 upload.
- TikTok publish-status polling and publication workflow states for scheduled, publishing, published, failed, and auth-required outcomes.
- Supabase queries and updates by platform or platform/account.
- Scheduler integration with social-phase error isolation.
- Disabled example target configuration, token environment-variable placeholders, compatibility wrappers, and focused unit tests.

## Not Implemented Yet

These are blockers for a live rollout, not optional cleanup:

1. **OAuth lifecycle:** the current executor reads a static access token from an environment variable. It has no authorization callback, authorization-code exchange, encrypted per-account token store, refresh-token rotation, or revoke flow. TikTok access tokens expire, so a manually copied token is only suitable for a short smoke test.
2. **Creator capability validation:** Direct Post must query creator info immediately before posting. The current request does not verify the authorized creator, allowed privacy levels, interaction settings, or maximum duration.
3. **Crash-safe idempotency and leasing:** a crash after TikTok creates a `publish_id` but before Supabase stores it can cause a duplicate upload. Parallel scheduler workers can also claim the same row because there is no atomic lease.
4. **Retry without regeneration:** failed and `auth_required` rows are not selected again, and there is no retry command to reset a delivery safely. This is still an open requirement from issue #95.
5. **Full child-publication lifecycle:** the approval path creates TikTok rows, but later rescheduling, rejection, withdrawal, deletion, or source replacement does not yet propagate to child rows.
6. **Complete status persistence:** status polling does not yet retain TikTok `fail_reason`, the publicly available post id, or the final public URL. `external_id` remains the upload `publish_id`.
7. **Platform adapter boundary:** the row model is reusable, but the generic social wrapper currently dispatches only TikTok and the target model embeds TikTok-specific settings. Introduce an adapter registry before Instagram/Facebook work.
8. **TikTok analytics:** analytics ingestion remains YouTube-only.
9. **Scheduling semantics:** `schedule_mode` is normalized and stored but is not acted on; all additional targets currently inherit the YouTube schedule.
10. **Decision record:** issue #95 requested an OSS/browser/API comparison, but the branch records only the selected official API approach. Capture the alternatives, licenses, operational risks, and final rationale before closing the issue.

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

## TikTok Account and App Onboarding

Operator/external steps:

1. Create or select the TikTok account that will own the posts.
2. Create a TikTok developer app and add Login Kit plus the Content Posting API.
3. Register the production OAuth redirect URI for the Mac-hosted ORION auth flow.
4. Request the `video.publish` scope and complete user authorization for each TikTok account.
5. Keep posts `SELF_ONLY` while the client is unaudited; complete TikTok app review before enabling public posts.

Application work that must land before step 4 is useful for automation:

1. Add authorization-code exchange and refresh-token rotation with runtime-only secret storage.
2. Add creator-info querying and validate privacy, interaction, and duration choices before init.
3. Add atomic publication claiming, persist `publish_id` before upload where the API flow permits it, and make retries idempotent.
4. Add an explicit operator retry/re-auth command and preserve structured TikTok failure details.
5. Run one `SELF_ONLY` end-to-end upload of an existing approved video, poll it to completion, and verify the stored delivery row.
6. Only then change the target to `enabled: true`; reinstall/reload the Mac publication schedule if its active slots change.

Official references:

- [Content Posting API get started](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [Query creator info](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info?enter_method=left_navigation)
- [Get post status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
- [OAuth access and refresh token management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management)
- [TikTok API scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation)

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

The checked-in registry is the active default for the scheduler, not merely sample prose. After onboarding, update the intended channel entry, sync it to `video_channels`, and keep all token values outside Git.

## Rollout Checklist

- [x] Additional-platform row model and deterministic fan-out.
- [x] TikTok Direct Post init, local chunk upload, and status polling scaffold.
- [x] Scheduler integration and YouTube failure isolation.
- [x] Merge conflict and original Runtime Validation whitespace failure fixed.
- [x] Product-video, focused integration, and Discord/runtime test suites pass locally.
- [ ] TikTok account selected/created.
- [ ] TikTok developer app, products, redirect URI, and `video.publish` scope configured.
- [ ] OAuth callback, secure refresh-token storage, and automatic refresh implemented.
- [ ] Creator-info validation implemented.
- [ ] Atomic claim/idempotency and operator retry implemented.
- [ ] Final status/failure/public-post fields persisted.
- [ ] One `SELF_ONLY` Mac mini smoke publication completed and reconciled.
- [ ] Public-posting app review completed, if public delivery is required.
- [ ] Target enabled for the first account and scheduler reloaded.
- [ ] TikTok analytics adapter planned after publication is stable.

## Validation Commands

```powershell
node scripts/ci/validate-runtime-config.mjs
git diff --check main
npm.cmd run test:product-video-agent
npm.cmd run test:discord-spine
node --test services/product-video-agent/test/video-publication-scheduler.test.mjs services/product-video-agent/test/execute-social-publication.test.mjs services/product-video-agent/test/social-publication-targets.test.mjs services/product-video-agent/test/tiktok-publication.test.mjs services/task-router/test/product-video-executor.test.mjs
```

## Primary Vault Context

The Mac mini primary vault confirms the shared scheduler and per-platform delivery-row direction but contains no completed TikTok app/auth setup. Relevant notes under `/Users/Agent/Vault/Jacobs-2/07_Products/Product_Video_Agent/` are:

- `Publication_Flow.md` — platform-adapter architecture, approval gating, scheduler isolation, and schedule reload behavior.
- `Validation_And_Change_Log.md` — one master video with separate per-platform publication rows.
- `Pokemon_Video_System.md` — channel-scoped queue, schedule, and reconciliation behavior.
- `T7_And_Assets.md` — media stays local while delivery metadata lives in Supabase.
- `Templates.md` — future platforms should reuse the same queue and policy layer.
- `Analytics.md` — analytics ingestion is currently YouTube-only.
