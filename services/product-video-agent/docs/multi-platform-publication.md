# Multi-Platform Publication

This is the phase-1 structure for publishing an already approved ORION short to additional platforms.

## Status (2026-10-07)

- Tracking issue: [#95 — ORION Multi-Platform Social Publisher, Phase 1: TikTok](https://github.com/OfficialLachkid/ORION/issues/95)
- Implementation PR: [#97 — scaffold TikTok social publisher](https://github.com/OfficialLachkid/ORION/pull/97)
- State: PRs #151, [#152](https://github.com/OfficialLachkid/ORION/pull/152), and #154 are merged. PR #152 binds TikTok consent to the existing Discord Publish action, adds atomic upload claims, persists the TikTok `publish_id` before bytes are uploaded, and adds a guarded retry command. PR #154 makes scheduler wake times derive from active channel schedules and sets future Poke Quiz approvals to `is_aigc: false`. The Poke Quiz target remains enabled only for private `SELF_ONLY` Sandbox delivery.
- Operator update: the dedicated Poke Quiz TikTok account, the `ORION` TikTok developer organization, and the `ORION Publisher` app now exist. The sandbox includes `pokequizz7` as a target user. Public app metadata, legal-policy URLs, URL-prefix ownership verification, Login Kit, Content Posting API Direct Post, and the Desktop redirect URI are configured. TikTok issued the client credentials; no credential value is recorded in Git.
- The PR branch has been brought forward to current `main`; the scheduler conflict was resolved by retaining current per-channel error isolation and adding isolated social-publication execution.
- The original Runtime Validation failure was only `git diff --check`: this file and `src/tiktok-publication-executor.mjs` had an extra blank line at EOF. Both are fixed.
- Local verification on 2026-10-06: runtime-config validation passed, the product-video suite passed (454 passed, 1 skipped), the Discord/runtime suite passed (369 passed), and the focused TikTok/scheduler/task-router suite passed (31 passed).

This is not approved for public TikTok delivery. OAuth refresh, creator validation, shared-review consent, and crash-safe upload handling are implemented. A supervised `SELF_ONLY` smoke test completed successfully on 2026-10-07. PR #154 is deployed to the Mac mini; the publication scheduler and reconciler were reloaded with the dynamic `08:00`, `12:00`, `14:00`, and `18:00` machine wake-up union. Runtime-config validation and the 35 focused publication tests passed on the Mac after deployment.

## Implemented

- Generic additional-target discovery from a source channel profile.
- Deterministic, idempotent sibling `video_publications` rows linked to the same `videos` row.
- Fan-out after the approved YouTube publication receives a schedule slot; a fan-out failure does not roll back YouTube.
- A TikTok `FILE_UPLOAD` client for Direct Post initialization and chunked MP4 upload.
- TikTok publish-status polling and publication workflow states for scheduled, publishing, published, failed, and auth-required outcomes.
- Supabase queries and updates by platform or platform/account.
- Scheduler integration with social-phase error isolation.
- Enabled private-Sandbox target configuration, token environment-variable placeholders, compatibility wrappers, and focused unit tests.
- Automatic access-token refresh with rotating refresh-token persistence in the ignored owner-only Mac runtime environment.
- A fail-closed Direct Post preflight that re-queries creator capabilities, verifies creator identity/privacy/interactions/duration, and requires explicit per-publication choices including commercial-content and AI-generated-content disclosures.
- One shared Discord approval: the existing Publish action displays and freezes the exact TikTok account, caption, privacy, interactions, disclosures, file size, and SHA-256 alongside the YouTube schedule.
- An atomic Supabase claim for due uploads, pre-upload `publish_id` persistence, and a guarded retry command that refuses to re-upload a row with an existing TikTok publish id.
- Channel-driven schedule inheritance: additional-platform rows copy the exact `scheduled_for` assigned from their source channel's `schedule_slots`; TikTok has no duplicated per-channel timetable.
- Scheduler-time child lifecycle reconciliation: an unstarted TikTok row follows a changed source schedule and is withdrawn or deleted if the shared source is revised, withdrawn, or deleted before delivery starts.
- Terminal TikTok status persistence: scheduler polling retains TikTok's `fail_reason`, public post id, and derived public post URL while keeping `external_id` as the upload `publish_id`.

## Not Implemented Yet

These are blockers for a live rollout, not optional cleanup:

1. **Post-start child lifecycle:** pre-upload schedule/cancellation propagation is implemented, but TikTok does not expose an ORION-integrated remote-delete path after upload initialization. A later source cancellation is marked for manual action rather than reported as remotely removed.
2. **Source replacement:** a newly rendered replacement still needs an explicit, tested link-and-supersede policy across all destination rows.
3. **Platform adapter boundary:** the row model is reusable, but the generic social wrapper currently dispatches only TikTok and the target model embeds TikTok-specific settings. Introduce an adapter registry before Instagram/Facebook work.
4. **TikTok analytics:** analytics ingestion remains YouTube-only.
5. **Cross-platform related content:** YouTube related-video selection exists, but no generic related-content contract or TikTok adapter exists yet. Preserve the current selector as a reusable policy boundary, investigate the official capability for each destination, and implement platform adapters without importing YouTube Studio/browser logic into the shared publisher.
6. **Scheduling modes:** `schedule_mode` is normalized and stored, but only `orion` inheritance is implemented. A future `immediate` mode must be explicit and tested rather than silently sharing the inherited path.
7. **Decision record:** issue #95 requested an OSS/browser/API comparison, but the branch records only the selected official API approach. Capture the alternatives, licenses, operational risks, and final rationale before closing the issue.

## Current Flow

YouTube remains the review and preview surface.

1. A rendered video is uploaded to YouTube as the preview/review copy. TikTok receives no preview upload.
2. The Discord card shows every destination plus the exact TikTok Direct Post settings. The existing Publish button is the single approval for that exact video and those settings.
3. The approval assigns the next slot from that source channel's `schedule_slots`, schedules the existing YouTube preview, and creates additional `video_publications` rows for enabled social targets with the same exact `scheduled_for`. TikTok approval is bound to the MP4 size and SHA-256; a changed file fails closed.
4. At the inherited due time, the shared publication scheduler uploads the TikTok row. Until then, the MP4 remains local and nothing is sent to TikTok.
5. The scheduler polls TikTok until processing reaches a terminal state and stores the public post id/URL or failure reason. In Sandbox, the account and unaudited app restrict the post to `SELF_ONLY`; after an approved Production migration, the configured creator-supported public privacy value can make the due-time upload public.

This keeps one Discord approval/reject flow. There is no separate TikTok editorial gate. Extra platforms are delivery records linked to the same `videos` row, not duplicated video jobs.

Automatic approval uses this same path. If a channel's existing policy invokes the normal Publish action automatically, enabled additional targets fan out from that action and inherit the assigned slot. Auto scheduling does not bypass the exact-file approval record or introduce a TikTok-only approval path.

### Channel-driven scheduling

- Each source channel owns one `schedule_slots` list. Additional platforms do not repeat those hours in their target configuration.
- The scheduler installer derives its macOS wake-up times from the deduplicated union of every active channel's slots. The currently loaded `08:00`, `12:00`, `14:00`, and `18:00` list is a machine-wide wake-up union, not the Poke Quiz TikTok schedule.
- A wake-up processes only rows that are due. For example, Poke Quiz currently owns `08:00`, `12:00`, and `14:00`; an `18:00` wake-up required by another channel does not create an extra Poke Quiz or TikTok post.
- Changing a channel's slots changes both its YouTube assignment and every inherited TikTok delivery time. No TikTok scheduling code or target timetable needs to be rewritten. After changing tracked channel slots, redeploy and rerun `npm run product-video:install-publication-schedule` so launchd receives the new union.

## TikTok V1

TikTok uses the official Content Posting API shape with local `FILE_UPLOAD`.

- No hosted storage bucket is introduced.
- ORION schedules locally by holding a `tiktok_video` publication row until it is due.
- Unaudited TikTok apps should use `SELF_ONLY` privacy. Public posting requires TikTok app review approval.
- Missing tokens fail closed into `auth_required`; YouTube scheduling is not rolled back.
- Missing/stale per-post consent or incompatible creator settings fail closed into `approval_required`; no TikTok init request is made.

### AI-generated-content disclosure

Database-backed facts, existing visual assets, deterministic rendering, and using AI to select or arrange those inputs do not by themselves require ORION to mark a post as AI-generated. The disclosure applies to the media in the finished post, not merely to automation in the production workflow.

The current Poke Quiz renderers generate some spoken narration with the Kokoro machine-learning text-to-speech model. TikTok's broad AIGC guidance may therefore apply to the exported audio even though the facts and visuals are database-backed. The operator has chosen `is_aigc: false` for future private Sandbox posts and will restore the label if TikTok treats that choice as non-compliant. The shared review card must continue to show and freeze that explicit choice.

If TikTok flags the content, changes its guidance, or requires disclosure during review, restore `is_aigc: true`. A later provenance implementation should derive a recommended value from the exact render while still making the submitted choice visible at approval time. Existing approved or uploaded delivery rows keep their frozen historical value.

### Sandbox and Production Lifecycle

Sandbox is the correct environment for development. It is not a production app that later changes mode in place.

1. Build and demonstrate the complete integration in Sandbox with added target users and `SELF_ONLY` posts.
2. In the TikTok portal, open **Production > Draft** and import the Sandbox configuration.
3. Recheck production website/legal URLs, products, scopes, redirect URI, and verified URL properties.
4. Record the required end-to-end demo in Sandbox, explain every requested product and scope, and submit the Production draft for review.
5. After the Production app and Direct Post audit are approved, re-authorize each creator against the live configuration and set `environment` to `production` plus `direct_post_audit` to `approved`.

Until that approval, keep privacy at `SELF_ONLY`. Sandbox target users are test allow-list entries, not a substitute for production authorization.

### Production Eligibility Risk

TikTok's Content Sharing Guidelines explicitly list a utility that uploads content only to accounts owned by the developer or their team as an unacceptable use case. The present internal-only description therefore creates a substantial review risk. Do not submit the current internal tool for production review as though approval were routine.

Before seeking public Direct Post access, choose one of these paths:

- turn ORION Publisher into a genuine creator-facing product that lets independent creators authenticate and exercise real control over their own posts; or
- keep ORION's TikTok workflow in private Sandbox/manual mode and do not depend on public automated Direct Post approval.

This is a platform-eligibility constraint, not a missing registration at the Dutch Chamber of Commerce.

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
- Keep `pokequizz7` as a **Personal** account for Sandbox testing and set the account itself to **private** before the first unaudited Direct Post test. A Business account is not required by the Content Posting API and cannot be private; switching now would conflict with TikTok's unaudited-client test restriction.
- Recovery contact details, two-step verification, avatar, and bio are optional account-hardening/profile choices. None is an ORION or Content Posting API prerequisite for the private Sandbox smoke.
- Reconsider Business Account status only if the channel's primary purpose becomes promoting a business. Business Accounts add business tools but lose access to TikTok's general music library. Regardless of account type, ORION may upload only original or properly licensed audio.

Application work before enabling automation:

1. Add operator alerting and a documented manual-removal procedure for a source cancelled after TikTok upload initialization.
2. Implement explicit source-replacement propagation before relying on unattended replacement delivery.
3. Replace the channel-wide AIGC setting with render-provenance-derived guidance before mixing synthetic-narration and non-synthetic formats on the same target.
4. Add a generic related-content contract and per-platform adapters after confirming what each official publishing API supports; reuse the existing selector policy without coupling other destinations to YouTube Studio automation.

Desktop authorization command on the Mac mini:

```bash
npm run product-video:authorize-tiktok -- --account poke-quizz-tiktok --expect-username pokequizz7
```

For a headless SSH session, add `--no-open` and forward local port `53684` to the Mac mini before opening the printed TikTok URL in the operator's browser. The command does not publish content and keeps the target disabled.

The standalone command remains available only for supervised backfills of videos approved before the shared review fields existed:

```bash
npm run product-video:approve-tiktok-post -- --publication <publication-id> --no-aigc
```

Normal new videos do not use a second TikTok approval. Their existing Discord Publish action records the same choices for YouTube and TikTok. The backfill command never uploads content.

Live sandbox validation on 2026-10-06:

- The Windows browser completed TikTok consent through an SSH loopback tunnel to the Mac callback.
- TikTok returned creator username `pokequizz7`, nickname `PokeQuizz`, and the exact scopes `user.info.basic,video.publish`.
- The access token, rotating refresh token, expiries, Open ID, and granted scopes were written only to the active Mac runtime `.env`; values were not printed or committed.
- The active `.env` was verified as owner-only (`0600`, `Agent:staff`).
- No upload or publication request was made during OAuth authorization.

Private Direct Post smoke on 2026-10-07:

- Source publication: `publication-0f5a57bcaf1027cf` (`Easy to Impossible Pokemon Pixels!`), using the retained archived master because the normal post-publication render path had already been cleared by retention.
- TikTok delivery row: `publication-target-87c842a2e1500bda`, linked to the same `videos` row as YouTube.
- Exact settings: `SELF_ONLY`; comments, Duet, Stitch, and both commercial-content toggles disabled; AI-generated-content label enabled.
- Live preflight re-confirmed creator `pokequizz7`, duration `28.6s`, file size `6,638,795` bytes, and creator availability for `SELF_ONLY`.
- TikTok returned publish id `v_pub_file~v2-1.7693854270151591958`; the first status poll returned `PUBLISH_COMPLETE` with no failure reason, and the delivery row was marked `published`.

Official references:

- [Content Posting API get started](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [Query creator info](https://developers.tiktok.com/docs/en/content-posting-api-reference-query-creator-info?enter_method=left_navigation)
- [Get post status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
- [OAuth access and refresh token management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management)
- [TikTok API scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes?enter_method=left_navigation)
- [Sandbox](https://developers.tiktok.com/docs/en/add-a-sandbox)
- [App review guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines)
- [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)

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
            "environment": "sandbox",
            "direct_post_audit": "unaudited",
            "expected_username": "pokequizz7",
            "privacy_level": "SELF_ONLY",
            "comments_enabled": false,
            "duet_enabled": false,
            "stitch_enabled": false,
            "brand_content_toggle": false,
            "brand_organic_toggle": false,
            "is_aigc": false,
            "video_cover_timestamp_ms": 1000
          }
        }
      ]
    }
  }
}
```

The Poke Quiz target is enabled for private Sandbox scheduling only. Keep `environment: sandbox`, `direct_post_audit: unaudited`, and `privacy_level: SELF_ONLY` until TikTok approves a production app and Direct Post audit.

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
- [x] Creator-info validation and fail-closed per-publication approval merged in PR #151.
- [x] Shared Discord approval records exact TikTok consent without a second editorial gate.
- [x] Atomic claim/idempotency and guarded operator retry merged in PR #152.
- [x] Final status/failure/public-post fields persisted by scheduler polling.
- [x] Pre-upload child schedule, withdrawal, and deletion lifecycle reconciled against the shared source row.
- [x] One `SELF_ONLY` Mac mini smoke publication completed and reconciled (`PUBLISH_COMPLETE`, 2026-10-07).
- [ ] Public-posting app review completed, if public delivery is required.
- [x] Private Sandbox target enabled in tracked configuration for the first account.
- [x] Mac scheduler and reconciler reloaded after PR #154; runtime config and focused validation passed (35/35, 2026-10-07).
- [ ] Generic related-content contract and TikTok capability/adapter investigated after core publication lifecycle is stable.
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

The Mac mini primary vault records the completed Sandbox app/auth/smoke setup, shared scheduler behavior, and per-platform delivery-row direction. Relevant notes under `/Users/Agent/Vault/Jacobs-2/07_Products/Product_Video_Agent/` are:

- `Publication_Flow.md` — platform-adapter architecture, approval gating, scheduler isolation, and schedule reload behavior.
- `Validation_And_Change_Log.md` — one master video with separate per-platform publication rows.
- `Pokemon_Video_System.md` — channel-scoped queue, schedule, and reconciliation behavior.
- `T7_And_Assets.md` — media stays local while delivery metadata lives in Supabase.
- `Templates.md` — future platforms should reuse the same queue and policy layer.
- `Analytics.md` — analytics ingestion is currently YouTube-only.
