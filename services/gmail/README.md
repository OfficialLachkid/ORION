# services/gmail

Gmail sender module for O.R.I.O.N. outbound. Uses OAuth 2.0 with a local-loopback
redirect and the least-privilege `gmail.send` scope.

## Contents

- `src/config.mjs` — reads `config/gmail/.env` via the shared runtime config layer.
- `src/oauth.mjs` — authorize URL builder, one-shot code exchange, and access-token refresh from a stored refresh token.
- `src/mime.mjs` — builds RFC 822 messages and encodes to Gmail's base64url wire format.
- `src/send.mjs` — sends a Gmail message or creates a draft-only copy when `GMAIL_DRAFT_ONLY=true`.

## Setup

1. Complete the vault playbook `~/Vault/Jacobs-2/05_Playbooks/Gmail_Setup_Playbook.md` (Google Cloud project + OAuth Client + consent screen).
2. Copy `config/gmail/.env.example` to `config/gmail/.env` and fill in `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_SENDER_EMAIL`.
3. Run `npm run gmail:authorize`. A browser tab will open on Google's consent screen; grant the requested `gmail.send` scope. The script captures the returned code on `http://127.0.0.1:53682/callback`, exchanges it for tokens, and writes `GMAIL_REFRESH_TOKEN` into `config/gmail/.env`.
4. Verify with `npm run gmail:send-test -- --to you@example.com --subject "Smoke test" --body "hello"`. Add `--draft-only` to leave the message in Drafts instead of sending.

## Runtime rules

- The refresh token is treated as a credential. Never log it, never post it into Discord, never commit `config/gmail/.env`.
- `GMAIL_DRAFT_ONLY=true` forces the module to create a draft even when the caller asks to send. Useful for early testing weeks.
- The module does not send on its own. Callers are expected to gate every send through the existing Discord approval pipeline.
