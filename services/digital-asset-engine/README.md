# ORION Digital Asset Engine

The first vertical slice converts a validated product opportunity into a canonical, marketplace-independent product and can generate pixel-art assets locally through Ollama.

Safety defaults:

- planning is separate from execution;
- generation requires `--execute`;
- Ollama must be on the local machine;
- no cloud fallback or per-image API billing;
- output is blocked from distribution until human review;
- generation is not connected to night shift yet;
- canonical license text remains a draft until reviewed.

Plan the included issue #146 opportunity:

```bash
npm run digital-assets:plan
```

Generate on the Mac after confirming Ollama is idle:

```bash
npm run digital-assets:generate -- --execute
```

Set `DIGITAL_ASSET_ARCHIVE_ROOT` to place canonical products on the T7, for example `/Volumes/T7/O.R.I.O.N. Digital Assets`.
