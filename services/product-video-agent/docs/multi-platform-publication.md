# Multi-Platform Publication

This is the phase-1 structure for publishing an already approved ORION short to additional platforms.

## Status (2026-10-06)

- Tracking issue: [#95 — ORION Multi-Platform Social Publisher, Phase 1: TikTok](https://github.com/OfficialLachkid/ORION/issues/95)
- Implementation PR: [#97 — scaffold TikTok social publisher](https://github.com/OfficialLachkid/ORION/pull/97)
- State: the publishing scaffold and Desktop OAuth client are implemented and tested. The sandbox account is connected and verified, while the publication target remains disabled pending the remaining safety work.
- Operator update: the dedicated Poke Quiz TikTok account, the `ORION` TikTok developer organization, and the `ORION Publisher` app now exist. The sandbox includes `pokequizz7` as a target user. Public app metadata, legal-policy URLs, URL-prefix ownership verification, Login Kit, Content Posting API Direct Post, and the Desktop redirect URI are configured. TikTok issued the client credentials; no credential value is recorded in Git.
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

1. **Production merge/deployment:** Desktop authorization now uses PKCE and anti-forgery state, verifies the authorized creator, stores access and rotating refresh tokens only in the ignored Mac runtime environment, and refreshes expired access tokens. The live sandbox authorization succeeded for `pokequizz7`, but this implementation must pass PR validation, merge to `main`, and be pulled by the Mac scheduler before scheduled jobs can use the refresh path.
2. **Creator capability validation at publication time:** onboarding verifies the creator with TikTok's creator-info endpoint, but Direct Post must query creator info again immediately before every post. The current publication request does not yet validate the latest privacy levels, interaction settings, or maximum duration.
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

Current portal decisions:

- App owner: `ORION` organization.
- App name: `ORION Publisher`.
- App type: `Other` (the type that includes Content Posting API integrations).
- The client secret must remain outside Git and must never be placed in a portal URL field or documentation.
- The app's public information and legal pages are versioned under `orion-publisher/`, deployed by the existing GitHub Pages workflow, and confirmed live:
  - Website: `https://officiallachkid.github.io/ORION/orion-publisher/`
  - Terms: `https://officiallachkid.github.io/ORION/orion-publisher/terms/`
  - Privacy: `https://officiallachkid.github.io/ORION/orion-publisher/privacy/`
- Public account-disconnection and data-deletion instructions are available at `https://officiallachkid.github.io/ORION/orion-publisher/data-deletion/` after the follow-up Pages deployment.
- The policies identify `Valentijn Jacobs` in the Netherlands as the operator/controller and use `vbjtechservices@gmail.com` as the public contact. ORION is not described as a registered company.
- The public notices now include an explicit request-based disconnection/deletion flow, GDPR rights and response timing, processing sources and legal bases, retention criteria, provider categories, international-processing disclosure, cookie/log disclosure, and confirmation that no solely automated significant decisions are made.
- Before a production launch, obtain Dutch legal review and decide whether to publish a correspondence address. If ORION later becomes a registered business, update the operator identity, KVK number, VAT details where applicable, and contact address across the policies before the next TikTok review.
- For TikTok URL ownership, use **URL prefix** verification for the ORION Publisher Pages path rather than claiming ownership of the shared `github.io` domain. Commit TikTok's generated signature file to the exact requested path and redeploy Pages before completing verification.
- TikTok generated `tiktok99Ofd50KTfnADzBHf8Y8z9KmT5MLgzWR.txt` for the ORION Publisher URL prefix. The exact file is versioned at the root of `orion-publisher/`; click TikTok's final **Verify** only after that file returns HTTP 200 from the public Pages URL.
- Login Kit is configured for Desktop with `http://127.0.0.1:53684/callback/`. ORION's callback uses TikTok's required Desktop PKCE flow with a fresh verifier and anti-forgery state for each authorization.
- The active Mac mini stores app credentials and per-account OAuth tokens in `/Users/Agent/Workspace/ORION/config/product-video/.env`, with owner-only permissions. The tracked `.env.example` contains names/defaults only.
- App credentials use `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and `TIKTOK_OAUTH_REDIRECT_URI`. The `poke-quizz-tiktok` target derives its rotating token fields from `TIKTOK_POKE_QUIZZ_ACCESS_TOKEN`; secret values must never be copied into documentation, Git, terminal commands, or chat.

Application work that must land before step 4 is useful for automation:

1. Merge the OAuth implementation to `main`, pull it on the Mac mini, and re-run the focused production preflight without re-authorizing.
2. Add creator-info querying immediately before every Direct Post and validate privacy, interaction, and duration choices before init.
3. Add atomic publication claiming, persist `publish_id` before upload where the API flow permits it, and make retries idempotent.
4. Add an explicit operator retry/re-auth command and preserve structured TikTok failure details.
5. Run one operator-triggered `SELF_ONLY` end-to-end upload of an existing approved video, poll it to completion, and verify the stored delivery row.
6. Only then change the target to `enabled: true`; reinstall/reload the Mac publication schedule if its active slots change.

Desktop authorization command on the Mac mini:

```bash
npm run product-video:authorize-tiktok -- --account poke-quizz-tiktok --expect-username pokequizz7
```

For a headless SSH session, add `--no-open` and forward local port `53684` to the Mac mini before opening the printed TikTok URL in the operator's browser. The command does not publish content and keeps the target disabled.

Live sandbox validation on 2026-10-06:

- The Windows browser completed TikTok consent through an SSH loopback tunnel to the Mac callback.
- TikTok returned creator username `pokequizz7`, nickname `PokeQuizz`, and the exact scopes `user.info.basic,video.publish`.
- The access token, rotating refresh token, expiries, Open ID, and granted scopes were written only to the active Mac runtime `.env`; values were not printed or committed.
- The active `.env` was verified as owner-only (`0600`, `Agent:staff`).
- No upload or publication request was made, and the TikTok target remains disabled.

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
- [x] TikTok account selected/created for Poke Quiz.
- [x] `ORION` TikTok developer organization and `ORION Publisher` app created; client credentials issued and kept out of Git.
- [x] Public app metadata, Terms of Service, and Privacy Policy URLs published and entered in TikTok.
- [x] TikTok URL-prefix signature deployed and ownership verification completed.
- [x] Login Kit, Content Posting API Direct Post, Desktop redirect URI, and `video.publish` scope configured in sandbox.
- [x] OAuth callback, PKCE/state validation, owner-only refresh-token storage, rotation, and automatic access-token refresh implemented.
- [x] Live sandbox OAuth authorization completed and creator identity verified as `pokequizz7` with the required scopes.
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
