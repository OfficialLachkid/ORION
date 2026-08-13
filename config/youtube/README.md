# YouTube OAuth Setup

Place the Google OAuth desktop-app client JSON at:

`config/youtube/client-secret.json`

Do not commit that file. The folder `.gitignore` already excludes it.

Bootstrap a refresh token for a configured channel with:

`node scripts/youtube-authorize.mjs --channel video-channel-poke-quizz-youtube`

The current authorization flow now requests upload plus read-only analytics scopes:

- `https://www.googleapis.com/auth/youtube.upload`
- `https://www.googleapis.com/auth/youtube.force-ssl`
- `https://www.googleapis.com/auth/youtube.readonly`
- `https://www.googleapis.com/auth/yt-analytics.readonly`

If a channel refresh token was created before the analytics rollout on August 12, 2026, re-run the authorize flow so the stored token includes the new read-only scopes.

Store per-channel refresh tokens in:

`config/product-video/.env`

Recommended variable names already referenced by the channel registry:

- `YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN=`
- `YOUTUBE_TRIVAMON_REFRESH_TOKEN=`
- `YOUTUBE_POKE_GUESS_REFRESH_TOKEN=`
- `YOUTUBE_TECHY_GADGETS_REFRESH_TOKEN=`
