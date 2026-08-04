# YouTube OAuth Setup

Place the Google OAuth desktop-app client JSON at:

`config/youtube/client-secret.json`

Do not commit that file. The folder `.gitignore` already excludes it.

Bootstrap a refresh token for a configured channel with:

`node scripts/youtube-authorize.mjs --channel video-channel-poke-quizz-youtube`

Store per-channel refresh tokens in:

`config/product-video/.env`

Recommended variable names already referenced by the channel registry:

- `YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN=`
- `YOUTUBE_TECHY_GADGETS_REFRESH_TOKEN=`
