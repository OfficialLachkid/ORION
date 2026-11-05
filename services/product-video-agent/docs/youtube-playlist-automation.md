# YouTube playlist automation

ORION assigns newly generated short-form videos to YouTube playlists only after YouTube confirms that the video is public. Playlist failures are isolated from publication success.

## Dynamic discovery

Playlist automation does not contain a list of channel account keys or template identifiers.

- Every active `youtube_shorts` channel with a configured YouTube channel ID is enabled by default.
- A channel can opt out with `metadata.youtube_playlists.enabled: false`.
- Every new short-form plan receives a stable template classification derived from `template_id`.
- Template versions share one playlist because `.v1`, `.v2`, and later suffixes are removed from the stable playlist key.
- Long-form plans and plans with `publication_policy.playlist_enabled: false` are excluded.

Optional channel overrides:

```json
{
  "metadata": {
    "youtube_playlists": {
      "enabled": true,
      "template_playlists_enabled": true,
      "difficulty_playlists_enabled": true,
      "privacy": "public",
      "configuration_version": "youtube-playlists-v1",
      "max_attempts": 5,
      "retry_minutes": 30,
      "stale_claim_minutes": 15
    }
  }
}
```

These settings are overrides, not required onboarding work for a new channel.

## Classification

Each eligible video receives one template playlist. It receives a second global difficulty playlist only when planning emits `easy`, `medium`, or `hard`.

Round-count templates normalize relative difficulty deterministically:

- lowest configured round count: `easy`;
- highest configured round count: `hard`;
- intermediate round counts: `medium`.

Videos containing several difficulty stages do not receive a single global difficulty label unless their planner explicitly supplies one.

## Persistence and egress

`youtube_playlist_registry` stores one channel-scoped mapping from a stable playlist key to a YouTube playlist ID. `youtube_playlist_assignments` stores one video-to-playlist assignment. The latter name deliberately avoids confusion with paid YouTube channel memberships.

The publication metadata contains only a compact completion summary. Once its target signature and configuration version are verified, normal reconciliation performs no playlist-table read and no YouTube playlist call. Outstanding work reads at most the expected assignment rows and the registry entries it needs. Summary updates use a small merge RPC with `return=minimal`, so compact scheduler snapshots cannot overwrite full publication metadata.

## Failure recovery

Creation and assignment use atomic conditional claims. Stale claims become retryable after a bounded interval. Retry delay grows exponentially, permanent failures stop for review, and ambiguous playlist-item insertions are verified remotely before another insertion is attempted.

The existing publication reconciliation and night-shift execution paths call the same idempotent sync function. No extra worker, queue service, Redis instance, or full publication scan is introduced.

## Rollout safety

Normal runtime requires the normalized classification added to newly registered publications. Legacy published rows are not silently backfilled, preventing a deployment-time YouTube quota burst. Historical organization remains a separate future dry-run and bounded backfill operation.

## Bounded historical backfill

Backfill is an explicit operator action. It requires a channel selector, defaults to dry-run, reads only compact scalar metadata, processes newest videos first, and enforces a hard maximum of 25 videos per run. The dry-run reports a worst-case write-quota estimate before any YouTube call.

```bash
# Inspect the newest 10 ProffMon publications without writing anything.
npm run product-video:backfill-youtube-playlists -- --channel proffmon-youtube --limit 10

# Apply exactly that bounded channel run after reviewing the plan.
npm run product-video:backfill-youtube-playlists -- --channel proffmon-youtube --limit 10 --apply
```

The backfill classification is stored before YouTube mutation, so a restart can resume the same publication through the normal reconciler. Existing verified assignments are skipped. OAuth access is refreshed once per backfill run, and videos are processed sequentially rather than as a quota burst.

## Title-policy reconciliation

Template playlist naming is channel-independent and versioned in `config/youtube-playlist-policy.json`. A title-policy change affects future playlists immediately. Existing managed playlists can be inspected and updated without replacing their playlist IDs or memberships:

```bash
# Read-only plan for one exact channel.
npm run product-video:reconcile-youtube-playlists -- --channel proffmon-youtube

# Apply only the reported title and registry-version changes.
npm run product-video:reconcile-youtube-playlists -- --channel proffmon-youtube --apply
```

The command reads only the compact registry rows for the selected channel. It updates playlist metadata sequentially through the official YouTube API and is idempotent after the configured title and policy version match.
