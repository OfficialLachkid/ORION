# Multi-Platform Publication

This is the phase-1 structure for publishing an already approved ORION short to additional platforms.

## Status (2026-10-08)

- Tracking issue: [#95 — ORION Multi-Platform Social Publisher, Phase 1: TikTok](https://github.com/OfficialLachkid/ORION/issues/95)
- Implementation PR: [#97 — scaffold TikTok social publisher](https://github.com/OfficialLachkid/ORION/pull/97)
- State: PRs #151, [#152](https://github.com/OfficialLachkid/ORION/pull/152), #154, and [#155](https://github.com/OfficialLachkid/ORION/pull/155) are merged. PR #152 binds TikTok consent to the existing Discord Publish action, adds atomic upload claims, persists the TikTok `publish_id` before bytes are uploaded, and adds a guarded retry command. PR #154 makes scheduler wake times derive from active channel schedules and sets future Poke Quiz approvals to `is_aigc: false`. PR #155 adds pre-upload source/child lifecycle reconciliation, terminal TikTok post details, and the missing Runtime Validation path trigger for `services/product-video-agent/**`. The Poke Quiz target remains enabled only for private `SELF_ONLY` Sandbox delivery.
- Deployment: merged `main` at `7db91ea90` (through [PR #156](https://github.com/OfficialLachkid/ORION/pull/156)) was deployed to the Mac mini on 2026-10-08. Runtime-config validation passed, the full product-video suite passed there (488 passed, 1 skipped), and the dynamic scheduler/reconciler was reinstalled without initiating a publication.
- Lifecycle alerts: PR #156 alerts the existing video review thread after a post-start cancellation and adds an audited operator-resolution command; it does not introduce a second approval gate or perform an unverified remote deletion.
- Operator update: the dedicated Poke Quiz TikTok account, the `ORION` TikTok developer organization, and the `ORION Publisher` app now exist. The sandbox includes `pokequizz7` as a target user. Public app metadata, legal-policy URLs, URL-prefix ownership verification, Login Kit, Content Posting API Direct Post, and the Desktop redirect URI are configured. TikTok issued the client credentials; no credential value is recorded in Git.
- The PR branch has been brought forward to current `main`; the scheduler conflict was resolved by retaining current per-channel error isolation and adding isolated social-publication execution.
- The original Runtime Validation failure was only `git diff --check`: this file and `src/tiktok-publication-executor.mjs` had an extra blank line at EOF. Both are fixed.
- Local verification on 2026-10-06: runtime-config validation passed, the product-video suite passed (454 passed, 1 skipped), the Discord/runtime suite passed (369 passed), and the focused TikTok/scheduler/task-router suite passed (31 passed).

This is not approved for public TikTok delivery. OAuth refresh, creator validation, shared-review consent, crash-safe upload handling, and pre-upload lifecycle reconciliation are implemented. A supervised `SELF_ONLY` smoke test completed successfully on 2026-10-07. The publication scheduler and reconciler are loaded with the dynamic `08:00`, `12:00`, `14:00`, and `18:00` machine wake-up union.

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
- Post-start cancellation handling: if a source is cancelled after TikTok upload initialization, ORION posts a retryable alert into that video's existing Discord review thread and records the operator's eventual remote outcome. This is an operational safeguard, not a claim that ORION deleted the remote post.

## Not Implemented Yet

These are blockers for a live rollout, not optional cleanup:

1. **Source replacement:** a newly rendered replacement still needs an explicit, tested link-and-supersede policy across all destination rows.
2. **Platform adapter boundary:** the row model is reusable, but the generic social wrapper currently dispatches only TikTok and the target model embeds TikTok-specific settings. Introduce an adapter registry before Instagram/Facebook work.
3. **TikTok analytics:** analytics ingestion remains YouTube-only.
4. **Cross-platform related content:** YouTube related-video selection exists, but no generic related-content contract or TikTok adapter exists yet. Preserve the current selector as a reusable policy boundary, investigate the official capability for each destination, and implement platform adapters without importing YouTube Studio/browser logic into the shared publisher.
5. **Scheduling modes:** `schedule_mode` is normalized and stored, but only `orion` inheritance is implemented. A future `immediate` mode must be explicit and tested rather than silently sharing the inherited path.
6. **Decision record:** issue #95 requested an OSS/browser/API comparison, but the branch records only the selected official API approach. Capture the alternatives, licenses, operational risks, and final rationale before closing the issue.

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

The number of internally owned or managed accounts does not change that classification: one, two, ten, or twenty ORION/team accounts are still an internal-only uploader. A qualifying creator-facing product must genuinely be available to independent creators, let each creator connect and control their own account, and satisfy TikTok's review requirements. Do not expose the product merely as a review pretext if ORION does not intend to serve those creators.

Before seeking public Direct Post access, choose one of these paths:

- turn ORION Publisher into a genuine creator-facing product that lets independent creators authenticate and exercise real control over their own posts; or
- keep ORION's TikTok workflow in private Sandbox/manual mode and do not depend on public automated Direct Post approval.

This is a platform-eligibility constraint, not a missing registration at the Dutch Chamber of Commerce.

### Public Delivery for Internal-Only Accounts

ORION's actual requirement is to publish only to accounts owned or managed by ORION. Building an outside-creator product solely to obtain TikTok approval would conflict with that requirement and should not be pursued.

The recommended architecture is to use an already audited social scheduler as a delivery adapter. TikTok identifies established Content and Community Management partners that schedule and publish posts for brands. Buffer is a practical first candidate because its current GraphQL API supports connected TikTok channels and automatic video publishing from internal tools.

With this model:

1. ORION remains the private source of truth for rendering, the Discord approval, channel-owned `schedule_slots`, exact-file consent, and delivery state.
2. Each ORION-owned TikTok account is connected directly to the scheduler. The scheduler holds the TikTok authorization and uses its audited integration; ORION's TikTok developer app is not used for the public post.
3. After the shared Publish action assigns `scheduled_for`, ORION continues holding the MP4 locally. At the existing due-time scheduler pass, the adapter stages the exact approved MP4, asks Buffer to publish it immediately, and stores Buffer's post id. There is still no second editorial approval or duplicated timetable.
4. ORION polls the Buffer post state and removes the staged media only after confirmed delivery. Pre-delivery schedule changes and cancellations remain entirely inside ORION because Buffer receives nothing before the row is due.
5. The direct TikTok Sandbox adapter remains available for private integration tests only.

The intended operator flow remains one action: clicking **Publish** in the video's existing Discord review thread approves the exact MP4 once. YouTube retains its current preview/scheduling behavior, and an enabled `tiktok_video` destination using the Buffer delivery provider receives a child row with the same `scheduled_for`. Buffer is a transport/provider, not a new social platform; keeping `platform: tiktok_video` prevents provider-specific duplication and permits a later provider change without rewriting scheduling or historical platform data. Nothing is sent to Buffer early. When that row becomes due, ORION stages the approved file and invokes Buffer automatic publishing; a successful Buffer/TikTok post is expected to be public after TikTok processing. This is the target design, not current production behavior: until the provider adapter is implemented and validated, the deployed TikTok path remains Sandbox `SELF_ONLY`.

Buffer-specific constraint: its API does not accept local file uploads. It fetches video from an unauthenticated, stable public HTTPS URL when the post goes out, and its documentation warns against expiring signed URLs. The preferred adapter should therefore upload the MP4 only when ORION's own schedule says it is due, use a non-listable public Cloudflare R2 object with an unguessable key, call Buffer with `shareNow`, and delete the object only after Buffer confirms publication. A bounded cleanup policy must retain failed/in-flight objects for retry and remove abandoned objects later. This introduces a brief public staging boundary instead of changing the scheduler or hosting future videos for days, and requires operator approval before implementation.

Buffer also supports `customScheduled` plus a `dueAt` timestamp. That is a fallback if Buffer should own the future schedule, but it would require the public media URL to remain available until that future time and would duplicate part of ORION's existing schedule responsibility. It is not the preferred first implementation.

#### Accepted Buffer Rollout and Load Budget

The operator accepted Buffer as the public TikTok delivery adapter on 2026-10-08, subject to the one-account proof of concept and the controls below. This aligns with the existing system and is not a material Mac or Supabase workload at the current Poke Quiz cadence:

- No new always-running daemon is required. The adapter runs inside the existing channel-derived publication scheduler; the current main scheduler wakes at the four machine-wide slot times and the existing reconciliation pass follows five minutes later.
- No local transcoding or additional FFmpeg work is added. Upload the exact already-approved MP4 as a stream with concurrency `1`; Buffer/TikTok performs remote ingestion and processing.
- At the current three Poke Quiz slots and approximately 6.6 MB smoke-test file size, the new Mac traffic is roughly 20 MB/day plus small JSON requests. Buffer downloads the staged file from Cloudflare, not from the Mac.
- Reuse the existing `video_publications` row and metadata rather than adding duplicate scheduling tables. Supabase stores state only, never media bytes. A due delivery should normally add one atomic claim, a small number of state updates, and no more than a bounded handful of reads.
- Implement a server-filtered due query using platform/status/schedule fields instead of repeatedly loading historical platform rows. Existing platform/status and scheduled-publication indexes support this shape; add a more specific index only if measured query plans later justify it.
- Buffer `createPost` has no idempotency key. Never blindly repeat an uncertain `shareNow` write. On timeout or a dropped response, query Buffer for the target channel and narrow creation window, recover the existing post id if present, and retry creation only when the first write is known not to have succeeded.
- Poll with bounded backoff, persist the next poll time, process one upload at a time, and leave failed/in-flight R2 objects available for retry. This prevents API loops, Mac contention, and unnecessary Supabase writes.

At this scale the video upload is materially lighter than rendering, narration, captioning, or FFmpeg assembly. The first rollout must still record elapsed time, file size, Buffer request count, Supabase request count, peak memory, and cleanup outcome so the estimate is verified on the Mac rather than assumed.

Exact rollout sequence:

1. Operator: create one dedicated Buffer Free account for ORION, preferably with `vbjtechservices@gmail.com`.
2. Operator: make `@pokequizz7` public; it may remain a TikTok Personal account.
3. Operator: while logged into exactly `@pokequizz7` in the same browser, open Buffer **Channels**, choose **Connect a New Channel**, select TikTok, and approve Buffer's requested TikTok access.
4. Operator: in the connected TikTok channel settings, disable notification publishing by default. In Buffer's composer, verify the delivery type is **Automatic**, not **Notify Me**.
5. Operator: manually publish one already-approved Poke Quiz MP4 through Buffer using **Automatic**. Confirm it becomes public without a phone action, the baked audio is present, the caption is correct, and no unwanted AI-generated label or interaction setting is introduced. Remove the test afterward only if desired.
6. Operator: verify the Buffer account email, then open **Settings -> API -> Personal Access -> Keys -> New Key**. Name it `ORION Mac Publisher`, leave only `postsRead`, `postsWrite`, and `accountRead` selected, choose the one-year expiration, generate it, and copy it once. Store the expiration date for renewal; implementation must alert before expiry. Do not paste the key into chat or commit it. Authenticator-app 2FA is strongly recommended but is not a functional prerequisite.
7. Operator: create a Cloudflare R2 Standard bucket named `orion-publication-staging` with automatic location and public bucket access disabled. Under **Settings -> Object Lifecycle Rules**, add `expire-buffer-staging` for prefix `buffer/` with deletion after two days as a fallback for abandoned objects. From **R2 -> Overview -> Manage API Tokens**, create an Account API token with **Object Read & Write**, scoped only to this bucket. Save the Account ID, Access Key ID, Secret Access Key, and S3 endpoint; the secret is shown once. Cloudflare may require enabling R2 billing even when usage remains inside its free allowance.
8. Engineering: expose read-only, unguessable object paths through a minimal Cloudflare Worker on `workers.dev`; keep the R2 bucket private, support `GET`, `HEAD`, and byte ranges, and reject listing/write/delete requests publicly. Mac-held R2 credentials perform upload and deletion through the S3 endpoint.
9. Operator: initially store `BUFFER_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET=orion-publication-staging` only in `/Users/Agent/Workspace/ORION/config/product-video/.env`. Preserve owner-only `0600` permissions; never commit or paste the values into chat. Engineering will retrieve and record the non-secret Buffer organization/channel IDs through a read-only API call and set `R2_PUBLIC_BASE_URL` after deploying the Worker; the tracked `.env.example` will define names only.
10. Engineering: introduce a delivery-provider registry and a Buffer provider for `tiktok_video`, plus filtered due-row retrieval, atomic claim, exact-file revalidation, streaming R2 staging, Buffer `shareNow` with `schedulingType: automatic`, uncertain-write recovery, bounded status polling, cleanup, alerts, and focused tests. Preserve the existing direct TikTok driver for Sandbox diagnostics but select Buffer for the Poke Quiz public target.
11. Engineering: run dry-run and failure-path tests, deploy to the Mac, and perform one manually triggered API smoke against the Poke Quiz target without waiting for the normal slot. Confirm R2 cleanup and state/audit records.
12. Operator and engineering: approve one real Poke Quiz video through the existing Discord **Publish** action. Verify the same `scheduled_for` reaches YouTube and the Buffer child, that no TikTok preview upload occurs, and that the public TikTok post appears at the due time. Enable unattended operation only after this acceptance passes.

Current Buffer documentation says its Free plan includes up to three connected channels, ten scheduled posts per channel, one API key, and 3,000 API requests per month. One dedicated Free account can therefore cover Poke Quiz plus at most two additional connected channels under the current limits. Do not create one Free Buffer account per TikTok account to evade the three-channel allowance: Buffer's API terms prohibit circumventing feature/access controls, the published terms do not expressly authorize that account pattern, and it would multiply credentials, recovery, 2FA, and key-rotation risk. Treat it as unsupported unless Buffer confirms the intended multi-account use in writing. For more than three connected channels, budget for the applicable paid plan or select another compliant provider. Treat all pricing and limits as external configuration that must be rechecked before rollout.

Buffer connection state on 2026-10-08: `@pokequizz7` is connected as the first Free-plan channel and **Enable Notifications by default** is disabled. Buffer does not expose a separate persistent "automatic publishing" switch in the channel settings; **Automatic** versus **Notify Me** appears in the composer after a compatible TikTok video is attached. Empty Buffer posting slots are expected and may remain empty because ORION will use `shareNow` at its own inherited due time. The TikTok consent granted Buffer profile/username, public-video, analytics, comment read/write, and content-posting access. Those permissions apply only to Buffer's TikTok integration and do not grant Buffer access to the Mac, Supabase, Discord, YouTube, or the ORION repository. A manual Buffer UI post subsequently completed without phone intervention and appeared publicly on TikTok, validating the account authorization and Automatic delivery path.

#### Buffer Trust Boundary and Future Capabilities

Buffer would not receive access to the Mac filesystem, T7, Supabase, Discord, YouTube, the ORION repository, or an interactive shell. It would receive only what the adapter sends: the staged video URL, caption/post options, Buffer channel id, and API requests. Buffer separately holds the TikTok authorization for each connected TikTok account.

That still creates a meaningful third-party trust boundary. A compromised Buffer account or credential could read/manage Buffer posts and publish through connected channels within the granted permissions. Buffer may also store post content, metadata, tokens, and operational logs under its privacy policy and subprocessors. Its documentation describes configurable API-key permissions, 2FA, revocation/rotation, and security/privacy controls, but do not assume a certification such as SOC 2 without obtaining a current official assurance document from Buffer.

Security controls for any proof of concept:

- Create a dedicated Buffer account containing only ORION-owned TikTok channels, because a personal API key can access all organizations and channels in its Buffer account and cannot currently be restricted per organization.
- Authenticator-app 2FA and offline recovery-code storage are strongly recommended, but they are not a functional prerequisite for the proof of concept.
- Grant only `postsRead`, `postsWrite`, and the minimum account-read permission needed for channel discovery; disable ideas, account-write, and insight permissions unless a later feature requires them.
- Store `BUFFER_API_KEY` only in the ignored owner-only Mac runtime environment, never in Git, Discord, logs, or chat. Rotate/revoke it on any suspected exposure.
- Use one destination allow-list in tracked configuration so a compromised/mistyped channel id cannot redirect a publication silently.
- Keep media staging isolated from ORION infrastructure; the staging credential may upload/delete only within one dedicated bucket/prefix.

Buffer's public API currently supports post creation, retrieval, deletion, scheduling, connected-channel discovery, and limited/experimental metrics. It explicitly does **not** support reading or replying to comments; engagement is handled in Buffer's own UI. No documented Buffer API capability was found for attaching TikTok Shop affiliate products or managing affiliate campaigns. TikTok Shop Affiliate APIs are a separate developer/partner product and should be evaluated independently if ORION later adds affiliate workflows.

#### Free and First-Party Alternatives

There is currently no documented compliant way for an internal/team-only TikTok Direct Post client to auto-publish public videos. Submitting ORION for Production review truthfully is possible and does not require misrepresentation, but the written eligibility rule makes rejection likely even if the implementation is technically complete. Becoming registered at the Dutch Chamber of Commerce would not remove the intended-use restriction.

The zero-subscription-cost choices are therefore:

1. Keep the current Direct Post Sandbox path: ORION uploads at the dynamic due time as `SELF_ONLY`; an operator later makes the account public and changes each post to Everyone. This is local and free but not unattended public posting.
2. Add TikTok's Upload-to-Inbox mode: ORION sends the local MP4 as a TikTok draft and the operator opens the inbox notification, reviews it, and completes the public post in TikTok. This uses the separate `video.upload` scope and still requires TikTok approval/authorization; it is a manual-final-step workflow, not guaranteed production access for an internal-only app.
3. Keep everything local and have ORION send a due-time Discord reminder with the MP4 path/caption for manual TikTok upload or native TikTok scheduling. This is the lowest third-party risk and remains free, but loses unattended delivery.
4. Use Buffer Free for the first one to three TikTok accounts, subject to its ten-scheduled-posts-per-channel and API limits. This enables public automation through an audited third party but will not remain free when ORION exceeds the free channel allowance.

Multiple Free Buffer accounts are not the scaling plan. The compliant zero-cost scope is one dedicated Free account within its published allowance; more channels require written confirmation from Buffer or a paid/alternative route.

Browser automation or scraping TikTok's upload UI is intentionally excluded: it is brittle, creates account/credential risk, and attempts to bypass the supported API/review model.

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

1. Implement explicit source-replacement propagation before relying on unattended replacement delivery.
2. Replace the channel-wide AIGC setting with render-provenance-derived guidance before mixing synthetic-narration and non-synthetic formats on the same target.
3. Add a generic related-content contract and per-platform adapters after confirming what each official publishing API supports; reuse the existing selector policy without coupling other destinations to YouTube Studio automation.

Post-start cancellation procedure:

1. ORION posts one alert in the video's existing Discord review thread when the source is cancelled after a TikTok `publish_id` exists. It includes the destination/account, source and child states, publication ids, and any known TikTok post URL.
2. An operator opens TikTok and removes the post, makes it private, deliberately keeps it, or confirms that it cannot be found. ORION does not automatically claim remote removal.
3. Record the observed result so the action is auditable and does not reopen during later reconciliation:

```bash
npm run product-video:resolve-tiktok-lifecycle-action -- --resolve-lifecycle-publication-id <publication-id> --resolution <removed|made_private|kept|not_found> --resolution-note "What was verified in TikTok" --resolved-by "operator name"
```

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
- [x] Existing-review-thread alerting and audited manual resolution implemented for cancellations after TikTok upload initialization.
- [x] PR #156 deployed to the Mac mini at `7db91ea90`; runtime config and the full product-video suite passed (488/489 with one expected skip), and the scheduler/reconciler was reinstalled.
- [x] One `SELF_ONLY` Mac mini smoke publication completed and reconciled (`PUBLISH_COMPLETE`, 2026-10-07).
- [ ] Public-posting app review completed, if public delivery is required.
- [x] Operator selected Buffer as the audited scheduler adapter and accepted brief due-time public media delivery, subject to the one-account proof of concept (2026-10-08).
- [x] Dedicated Buffer Free account created, `@pokequizz7` connected as channel 1/3, and notification publishing disabled by default (2026-10-08).
- [x] One manual Buffer **Automatic** public Poke Quiz post verified without phone intervention (2026-10-08).
- [ ] Buffer key and private R2/Worker staging boundary configured in the owner-only Mac environment.
- [ ] Buffer delivery provider for `tiktok_video` implemented, failure-tested, deployed, and accepted with one shared-approval due-time post.
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
