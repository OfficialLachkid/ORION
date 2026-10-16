# Instagram Reels publication

Last updated: 2026-10-16

## Decision

ORION will integrate directly with Meta's Instagram Graph API. Buffer is not required for Instagram.

The selected authentication model is **Instagram API with Instagram Login** using
`graph.instagram.com`; it avoids creating and linking a Facebook Page. Do not mix it with the
older Facebook Login setup, its `graph.facebook.com` host, or its older permission names.

The initial scope is creator-owned Instagram professional accounts that are explicitly connected to the ORION Meta app. One Discord **Publish** approval remains the authorization for all configured destinations. Instagram receives no preview upload. Its child publication row inherits the source channel's assigned schedule and holds the exact approved MP4 identity until that time.

## Current implementation status

Implemented and merged in PR #163:

- `instagram_reels` as a reusable publication target type;
- one declarative target per Instagram account;
- shared-review metadata for every enabled Instagram destination;
- exact MP4 size and SHA-256 approval binding;
- direct Graph API adapter for container creation, status polling, publication, and permalink lookup;
- transient public MP4 staging in the existing `orion-publication-staging` bucket under `instagram/`;
- cleanup after Meta returns and ORION persists the published media id;
- fail-closed handling when a publish response is uncertain;
- adapter and integration unit tests.

Implemented and merged through PR #174:

- shared scheduler dispatch for TikTok and Instagram without duplicating channel schedules;
- atomic Instagram upload claiming and lifecycle reconciliation;
- persistence at the staging, container, and published-media boundaries;
- a read-only account diagnostic that requires the configured user id and username to match;
- a one-publication supervised live override for controlled validation;
- stale Instagram staging cleanup that protects objects referenced by active publications;
- the Poke Quizzz target for Instagram user `17841467563066221` / `@pokequizzz`;
- five-minute lifecycle reconciliation so finished containers are published promptly;
- isolated Discord alerts for platform delivery failures without blocking other destinations.

Current rollout:

- Poke Quizzz completed supervised and unattended public Reel delivery successfully;
- the Mac runtime has Instagram delivery enabled for verified configured targets;
- the tracked environment example remains fail-closed with `INSTAGRAM_DELIVERY_ENABLED=false`;
- every additional owned account must pass the same token identity check before deployment.

## Operational update: 2026-10-13

- The first supervised Instagram row (`publication-target-d6dbea768c608c17`) failed before any
  Meta request because its approved MP4 had been moved into the adjacent
  `Older Generated Videos` directory. It has no Instagram container id, media id, or permalink.
- PR #171 added fail-closed resolution of that known preview relocation for both approval creation
  and delivery. The merged fix was deployed to the Mac mini at `673e71948`.
- Three already-approved, future-scheduled Poke Quiz publications had durable Instagram consent
  but were missing their Instagram child rows. A bounded one-time reconciliation created them at
  the exact inherited YouTube times:
  - `publication-target-2a068641299792f1`: 2026-10-13 12:00 Europe/Amsterdam;
  - `publication-target-980f0d7aca6e10ec`: 2026-10-14 08:00 Europe/Amsterdam;
  - `publication-target-c03a2cc6bd135088`: 2026-10-14 11:00 Europe/Amsterdam.
- The corresponding TikTok children were preserved; withdrawn or already-published legacy rows
  were not backfilled. A deterministic Instagram dry run reports the first new row as
  `instagram_publish_due` at its inherited slot.
- Meta access was restored after the operator completed the identity checkpoint. The `/me`
  diagnostic passed, the supervised Reel published publicly, and unattended Poke Quizzz delivery
  was subsequently enabled.

## Completed supervised validation checkpoint

The original approved Poke Quiz delivery was prepared without enabling Instagram globally:

- source publication: `publication-880af1d8380e6ffd`;
- Instagram child: `publication-target-d6dbea768c608c17`;
- account: `@pokequizzz` through target `poke-quizzz-instagram`;
- inherited schedule: `2026-10-13T09:00:00Z` / 11:00 Europe/Amsterdam;
- the child row is bound to the exact approved MP4 SHA-256 and byte size;
- a dry run reported `instagram_publish_due` at that timestamp;
- a one-time macOS LaunchAgent invoked only this publication with
  `--allow-instagram-live`, but the missing source path stopped execution before Meta received it;
- the ordinary scheduler remained disabled during that first attempt, so no other Instagram
  publication was uploaded accidentally.

The replacement supervised delivery passed the `/me` identity diagnostic and published publicly.
The subsequent scheduler/reconciler fix was validated by successful TikTok and Instagram delivery.
Future accounts therefore reuse the same adapter, but still require an independent identity check
before their targets are activated.

The Poke Quizzz Creator account is connected as an app tester and its token is stored only in the
Mac runtime environment. Webhook subscriptions are intentionally disabled. The initial controlled
test uses Meta's dashboard-generated tester token; a general creator-facing OAuth flow is deferred
until ORION needs to connect accounts that are not app testers.

Instagram Login returns two different identifiers from `/me`: `user_id` is the professional
account/publishing id used by the media endpoints, while `id` is app-scoped. For Poke Quizzz,
the configured publishing id is `17841467563066221`. The connection diagnostic records both but
must match the target against `user_id`, never the app-scoped `id`.

## Owned-account expansion: 2026-10-16

Four additional Creator accounts were added as ORION Publisher test users. Their tokens remain only
in the owner-readable Mac runtime environment. Read-only Meta `/me` checks verified each token before
the targets were configured:

| Source channel | Instagram target | Publishing user id | Token environment variable |
| --- | --- | --- | --- |
| `proffmon-youtube` | `@proffmon` | `17841460825848023` | `INSTAGRAM_PROFFMON_ACCESS_TOKEN` |
| `dexguess-youtube` | `@dexguesss` | `17841435584465471` | `INSTAGRAM_DEXGUESS_ACCESS_TOKEN` |
| `trivamon-youtube` | `@trivamon` | `17841449539714324` | `INSTAGRAM_TRIVAMON_ACCESS_TOKEN` |
| `poke-guess-youtube` | `@pokeguesss` | `17841468340101871` | `INSTAGRAM_POKE_GUESS_ACCESS_TOKEN` |

Each account is an independent `instagram_reels` target. It inherits only its matching source
channel's shared Discord approval and current `scheduled_for` value.

PR #183 was deployed to the Mac mini on 2026-10-16 without replacing the active feature branch:
the merged `origin/main` was merged into the clean runtime worktree. The full Mac product-video
suite passed with 561 tests and one intentional skip. All five configured Instagram identities
then passed the live read-only diagnostic with delivery enabled.

An explicitly authorized, bounded reconciliation created 35 exact-file-bound Instagram children
from approved source publications that were still scheduled at the preflight cutoff. It created
8 ProffMon, 8 DexGuess, 11 TrivaMon, and 8 Poke Guess rows. The operation excluded past,
published, withdrawn, and already-linked sources, recorded the operator authorization on each
source, and preserved every inherited YouTube schedule.

The first shared 12:00 Europe/Amsterdam slot provided live end-to-end validation. The scheduler
created five independent Meta containers and the 12:05 reconciler published all five Reels without
failure:

- Poke Quizzz: <https://www.instagram.com/reel/DejRkyajxiJ/>
- ProffMon: <https://www.instagram.com/reel/DejRhzGid3m/>
- DexGuess: <https://www.instagram.com/reel/DejRiZ5AoJs/>
- TrivaMon: <https://www.instagram.com/reel/DejRlSxkfst/>
- Poke Guess: <https://www.instagram.com/reel/DejRi3TDdl1/>

All five publication rows reached `published`; the authenticated `instagram/` staging listing was
empty afterward, confirming that their temporary MP4 objects were removed. The remaining future
children stay scheduled and require no separate Instagram schedule or approval gate.

## Account model

Each account is an independent target in the source YouTube channel profile:

```json
{
  "platform": "instagram_reels",
  "account_key": "poke-quizzz-instagram",
  "enabled": true,
  "schedule_mode": "orion",
  "delivery_provider": "instagram_graph",
  "visibility": "public",
  "instagram": {
    "user_id": "<META_INSTAGRAM_USER_ID>",
    "expected_username": "<INSTAGRAM_USERNAME>",
    "access_token_env": "INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN",
    "share_to_feed": true
  }
}
```

Adding another account means adding another target and its own token environment variable. Channel schedules are not copied into Instagram configuration; every target inherits the source publication's current `scheduled_for` value, including later schedule changes.

Secrets belong only in the owner-readable Mac runtime environment. App secrets and access tokens must never be committed.

## Meta setup checklist

Dashboard labels change periodically. Use the option whose description says it provides the Instagram API for professional accounts.

1. Create the Instagram account, make it public, and switch it to a **Creator** or **Business** professional account. Creator is sufficient for Reels publishing.
2. Open [Meta for Developers](https://developers.facebook.com/apps/) and select **Create app**.
3. Select the Instagram/API use case if it is shown. In the older flow select **Other**, then **Business**.
4. Use app name `ORION Publisher` and contact email `vbjtechservices@gmail.com`.
5. Select the ORION Business Portfolio if one exists. A Dutch Chamber of Commerce registration is not required merely to create a Meta developer app or Business Portfolio, although Meta may request business verification later for broader production access.
6. In the app dashboard, add **Instagram** and choose **API setup with Instagram Login**. This path does not require a Facebook Page.
7. Request only:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   Do not add Meta's bundled messaging/comment permissions for publication-only use.
8. Keep the app in Development mode during the first controlled integration.
9. Add the ORION operator/developer account under **App roles** and add the Poke Quiz Instagram account as an Instagram tester when the dashboard requests one.
10. Accept the tester invitation while logged into that Instagram account.
11. A redirect URI is not required for the first dashboard-generated tester token. Do not invent one. Register an exact callback only when ORION implements a reusable OAuth connection flow.
12. Do not send the App Secret or access token through Discord, GitHub, or chat. Store them in `config/product-video/.env` on the Mac only.

Business Login, webhooks, and App Review are not required for the first test-account publication.
Keep the app in Development mode until the supervised Reel succeeds. The Meta dashboard currently
directs apps that need hashtag search or Insights to the Facebook Login setup; do not change the
working authentication model merely to add analytics. Treat analytics as a separate later phase.

The planned environment names are:

```dotenv
INSTAGRAM_GRAPH_API_VERSION=<VERSION_SHOWN_IN_META>
INSTAGRAM_APP_ID=<APP_ID>
INSTAGRAM_APP_SECRET=<APP_SECRET>
INSTAGRAM_OAUTH_REDIRECT_URI=<EXACT_CALLBACK_URI>
INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN=<ACCOUNT_ACCESS_TOKEN>
INSTAGRAM_DELIVERY_ENABLED=false
```

## Delivery sequence

1. ORION uploads the YouTube preview as it does today.
2. The Discord review card lists YouTube, TikTok, and every enabled Instagram account.
3. One **Publish** action approves the exact MP4, caption, account, and Share-to-Feed choice.
4. ORION creates one child row per destination using the same assigned schedule.
5. At the due time, Instagram staging uploads the MP4 to the existing temporary Supabase bucket.
6. ORION asks Meta to create a Reel container using the public temporary URL.
7. The container id is persisted before polling continues.
8. When Meta reports `FINISHED`, ORION calls `media_publish`.
9. The media id is persisted before the temporary MP4 is deleted.
10. ORION stores the Reel permalink and marks the child row published.

If the network drops during `media_publish`, ORION does not blindly repeat the request. It records an uncertain outcome for operator reconciliation, preventing duplicate Reels.

## Remaining engineering phases

### Phase 2: account connection and identity validation

- [x] use dashboard-generated tester tokens for owned accounts;
- [x] query the authenticated Instagram user id and username;
- [x] reject target configuration when the authenticated identity differs from the configured account;
- [x] run the read-only connection diagnostic before any live publication;
- [ ] implement an interactive OAuth callback, token exchange, and refresh command when scaling
  beyond tester accounts.

### Phase 3: scheduler dispatch

- [x] route `instagram_reels` rows through the shared social publication phase;
- [x] preserve atomic upload claiming and source lifecycle reconciliation;
- [x] persist staging, container, and media ids at every irreversible boundary;
- [x] gate live delivery behind `INSTAGRAM_DELIVERY_ENABLED` and a one-publication supervised override;
- [x] add stale `instagram/` staging cleanup protection.

### Phase 4: supervised validation

- [x] configure Poke Quiz as an enabled target while keeping global live delivery disabled;
- [x] create the Instagram child from the normal shared Discord approval;
- [x] run a dry-run due-publication check;
- [x] register a one-publication supervised execution for the inherited schedule;
- [x] verify public visibility and successful scheduled publication;
- [x] enable unattended delivery only after supervised validation.

### Phase 5: access review, if needed

Development-mode users with app roles/tester access are used for the first owned-account integration. If Meta requires Advanced Access or App Review for unattended use or additional accounts, submit only the two permissions actually used and provide an end-to-end screencast. Do not request comments, messages, insights, ads, or unrelated permissions until ORION implements and needs them.

## Meta API requirements used by the adapter

Meta's official collection documents the Reels flow as:

- `POST /{ig_user_id}/media` with `media_type=REELS`, a publicly reachable `video_url`, caption, and `share_to_feed`;
- poll `GET /{container_id}?fields=status_code,status` until `FINISHED`;
- `POST /{ig_user_id}/media_publish` with the container id;
- retrieve the resulting media and permalink.

The adapter keeps the Graph API version explicit in runtime configuration so a future Meta version migration is deliberate rather than silently changing behavior.

References:

- [Meta Instagram API official collection](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)
- [Meta Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login)
- [Meta Reels publishing requests](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api)
