# Instagram Reels publication

Last updated: 2026-10-09

## Decision

ORION will integrate directly with Meta's Instagram Graph API. Buffer is not required for Instagram.

The selected authentication model is **Instagram API with Instagram Login** using
`graph.instagram.com`; it avoids creating and linking a Facebook Page. Do not mix it with the
older Facebook Login setup, its `graph.facebook.com` host, or its older permission names.

The initial scope is creator-owned Instagram professional accounts that are explicitly connected to the ORION Meta app. One Discord **Publish** approval remains the authorization for all configured destinations. Instagram receives no preview upload. Its child publication row inherits the source channel's assigned schedule and holds the exact approved MP4 identity until that time.

## Current implementation status

Implemented on `feat/instagram-reels-publisher`:

- `instagram_reels` as a reusable publication target type;
- one declarative target per Instagram account;
- shared-review metadata for every enabled Instagram destination;
- exact MP4 size and SHA-256 approval binding;
- direct Graph API adapter for container creation, status polling, publication, and permalink lookup;
- transient public MP4 staging in the existing `orion-publication-staging` bucket under `instagram/`;
- cleanup after Meta returns and ORION persists the published media id;
- fail-closed handling when a publish response is uncertain;
- adapter and integration unit tests.

Deliberately not enabled yet:

- no Instagram target exists in the live channel registry;
- `INSTAGRAM_DELIVERY_ENABLED` defaults to `false`;
- OAuth/token provisioning is not implemented yet;
- the shared social scheduler does not dispatch Instagram rows yet;
- no live Reel has been created.

## Account model

Each account is an independent target in the source YouTube channel profile:

```json
{
  "platform": "instagram_reels",
  "account_key": "poke-quizz-instagram",
  "enabled": false,
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
8. Keep the app in Development mode during the first controlled integration.
9. Add the ORION operator/developer account under **App roles** and add the Poke Quiz Instagram account as an Instagram tester when the dashboard requests one.
10. Accept the tester invitation while logged into that Instagram account.
11. Do not invent a redirect URI. The next engineering increment will add the ORION OAuth callback helper; its exact URI must be registered byte-for-byte in Meta before authorization.
12. Do not send the App Secret or access token through Discord, GitHub, or chat. Store them in `config/product-video/.env` on the Mac only.

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

### Phase 2: OAuth and account connection

- implement a local one-time authorization command;
- decide and verify the callback URI accepted by the current Meta dashboard;
- exchange and refresh the account token;
- query the authenticated Instagram user id and username;
- reject target configuration when the authenticated identity differs from the configured account;
- add a connection diagnostic that performs read-only profile validation.

### Phase 3: scheduler dispatch

- route `instagram_reels` rows through the shared social publication phase;
- preserve atomic upload claiming and source lifecycle reconciliation;
- persist staging, container, and media ids at every irreversible boundary;
- gate live delivery behind `INSTAGRAM_DELIVERY_ENABLED` and a one-publication supervised override;
- add stale `instagram/` staging cleanup protection.

### Phase 4: supervised validation

- configure Poke Quiz as a disabled target;
- run a dry-run due-publication check;
- enable one targeted supervised Reel;
- verify public visibility, caption, Share to Feed behavior, permalink, and staging deletion;
- only then enable unattended delivery.

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
