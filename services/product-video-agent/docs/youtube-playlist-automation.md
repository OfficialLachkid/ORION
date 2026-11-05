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
