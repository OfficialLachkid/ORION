# Facebook Page Reels publication

Last updated: 2026-11-09

## Decision

ORION publishes Facebook Reels explicitly through the Facebook Graph API. Instagram-to-Facebook
crossposting must remain disabled for every Page managed by this workflow; otherwise the same
approved video can appear twice.

Facebook is a first-class `facebook_reels` destination beside YouTube, TikTok and Instagram. It
inherits the source video's schedule and the same Discord publication decision, but receives its
own child publication row, upload state, permalink, retry history and delivery receipt.

Unlike Instagram and Buffer, Facebook Page Reels support direct binary upload. ORION sends the
approved MP4 from the Mac/T7 to the `upload_url` returned by Meta. The video is not copied to
Supabase Storage and no public temporary URL is required.

## What the implementation does

1. The Discord review shows every enabled Facebook Page target and its exact description.
2. Approval binds the Page id, expected Page name, MP4 path, byte size and SHA-256.
3. At the inherited due time, ORION claims only the Facebook child publication.
4. ORION creates a Reel upload session through `/{page-id}/video_reels`.
5. The returned video id and upload URL are persisted before file transfer.
6. ORION uploads the local MP4 bytes directly to Meta's returned upload URL.
7. Upload completion is persisted before the finish request.
8. ORION requests `video_state=PUBLISHED` and persists that irreversible boundary.
9. Later runs poll Meta until the Reel is public, then store its video id, permalink and timestamps.
10. Authentication, permission and processing failures use the shared `#alerts` path without
    blocking YouTube, TikTok or Instagram.

Each phase is resumable. A Mac restart after session creation, upload or publish submission resumes
from the stored boundary instead of creating a second Reel.

## Meta-side setup for the first Page

Meta changes dashboard labels periodically. Use the Page publishing product/use case available in
the current dashboard; do not create a second Meta app if the existing ORION Publisher app can be
granted Page access.

1. Confirm the Facebook Page is inside the intended Business Portfolio and that the ORION operator
   has full Page control.
2. Open the existing ORION Publisher app in Meta for Developers.
3. Add or configure Facebook Login for Business / the Pages API use case shown by the current UI.
4. Request the minimum publishing permissions:
   - `pages_show_list`;
   - `pages_read_engagement`;
   - `pages_manage_posts`.
5. Add `read_insights` when Facebook analytics collection is enabled.
6. Add `pages_manage_engagement` only when ORION implements Facebook comment management.
7. Add `business_management` only if the Business Portfolio setup requires it to enumerate or
   assign the Page. It is not part of the basic publishing path.
8. Keep the app in Development mode for the supervised Page-owner test. Advanced Access/App Review
   may be required before accounts outside the app's roles can use the integration.
9. Generate a user access token containing the selected permissions, then exchange/extend it using
   Meta's current long-lived-token flow.
10. Use that user token to request
    `/me/accounts?fields=id,name,access_token,tasks` and copy the matching Page id and Page access
    token. Never use a personal user token as the runtime Page token.
11. Confirm the returned Page tasks include the ability to create content.
12. Never paste the token into Discord, GitHub, an issue, a PR or chat.

## Mac runtime configuration

Store secrets only in `/Users/Agent/Workspace/ORION/config/product-video/.env`:

```dotenv
FACEBOOK_GRAPH_API_VERSION=<CURRENT_SUPPORTED_VERSION_SHOWN_BY_META>
FACEBOOK_GRAPH_ENDPOINT=https://graph.facebook.com
FACEBOOK_DELIVERY_ENABLED=false
FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN=<PAGE_ACCESS_TOKEN>
```

Keep `FACEBOOK_DELIVERY_ENABLED=false` through configuration and diagnostics. The tracked
`.env.example` also fails closed.

Add one declarative target to the matching source channel's `metadata.publisher.targets` array:

```json
{
  "platform": "facebook_reels",
  "account_key": "poke-quizz-facebook",
  "enabled": true,
  "schedule_mode": "orion",
  "delivery_provider": "facebook_graph",
  "visibility": "public",
  "facebook": {
    "page_id": "<FACEBOOK_PAGE_ID>",
    "expected_page_name": "Poke Quizz",
    "access_token_env": "FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN"
  }
}
```

The source channel remains the schedule owner. Do not create a second Facebook schedule in this
target. A new approved source video automatically receives its Facebook child row when this target
is enabled.

## Safe rollout

Run the read-only identity check first:

```bash
npm run product-video:execute-facebook-publication -- \
  --diagnose-account poke-quizz-facebook
```

The authenticated Page id and name must exactly match the configured values. A successful check
does not publish anything.

Then:

1. Generate a fresh video through the normal approval flow so its shared review includes Facebook.
2. Leave global Facebook delivery disabled.
3. Dry-run the Facebook worker and verify it reports only the intended publication as due.
4. Permit exactly that publication for the supervised test:

```bash
npm run product-video:execute-facebook-publication -- \
  --publication-id <FACEBOOK_CHILD_PUBLICATION_ID> \
  --allow-facebook-live
```

5. Let the ordinary reconciler continue the persisted upload/publish phases.
6. Verify the Reel on the Page, its public permalink and the stored Supabase receipt.
7. Verify Instagram did not crosspost a duplicate.
8. Only then set `FACEBOOK_DELIVERY_ENABLED=true` and restart the publication workers.

## Adding another Facebook Page later

For each additional Page:

1. Assign the Page to the existing Meta app/operator and grant the same minimum permissions.
2. Obtain that Page's id and Page access token.
3. Create a unique Mac `.env` variable for the token.
4. Add one `facebook_reels` target to the corresponding source channel profile.
5. Run the read-only identity diagnostic for the new `account_key`.
6. Generate a fresh review-bound publication; do not retrofit consent into an older approval.
7. Complete one targeted supervised publish.
8. Leave it enabled only after the Page id, name, permalink and receipt all verify.

No Supabase migration, new scheduler or provider-specific channel code is required. The existing
target fan-out, lifecycle queue, retry handling, Discord review and publication store are shared.

## Analytics and comments

The publication receipt intentionally stores a stable Facebook video id and permalink. Those are
the keys a later analytics adapter will use to write snapshots into the existing `video_analytics`
table. Add `read_insights` before enabling that collector. Because Meta changes insight metric
availability, the adapter must probe supported metrics and retain raw responses instead of failing
the entire sweep when one metric is unavailable.

Facebook comments should be a separate capability, like Instagram comments. If implemented, add
`pages_manage_engagement`, persist the remote comment id and reconcile an uncertain response before
retrying. Publishing success must never depend on comment success.

## Operational cautions

- A successful byte upload is not a published Reel. Only the final Meta status/permalink closes the
  publication.
- A timeout after the finish request is ambiguous. ORION records it for reconciliation and does not
  blindly create another Reel.
- Page role changes, password/security events or Business Portfolio changes can invalidate tokens.
  Authentication failures are surfaced in `#alerts` with the affected target.
- Graph API versions are explicit. Upgrade deliberately after testing; never silently follow an
  unversioned endpoint.
- Meta's Page Reels upload is direct and therefore avoids Supabase Storage egress. Database state
  and receipts still use the normal compact Supabase queries.

References:

- [Meta Facebook API collection: Reels Publishing](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api)
- [Meta local Reel upload request](https://www.postman.com/meta/facebook/request/ps1ahe4/2-a-upload-local-reel)
- [Meta for Developers](https://developers.facebook.com/apps/)
