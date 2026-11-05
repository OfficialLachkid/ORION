# Local Model Storage

ORION stores reusable local model weights in an APFS sparse bundle on the
Samsung T7. Applications and Python environments remain installed on the Mac;
only portable model data lives on the external SSD.

The T7 is ExFAT, which does not safely support the symlinks used by Hugging
Face caches. The sparse bundle preserves those macOS filesystem semantics and
grows only as model data is added. Its logical ceiling is 250 GB; it does not
reserve 250 GB immediately.

The registry at `config/runtime/local-models.json` defines the required Ollama
models, Hugging Face repositories, provider directories, and compatibility
paths. Add future models to that registry so verification and recovery remain
explicit.

The initial migration includes every downloaded reusable model found on the
Mac:

- Ollama: `x/flux2-klein:4b-fp8`, `x/flux2-klein:4b`, `llama3.1:8b`;
- faster-whisper: `small.en` and `medium`;
- Kokoro: `hexgrad/Kokoro-82M`.

Ollama's binary, Python virtual environments, FFmpeg, Node, and other runtimes
stay on the internal disk. They are small, machine-specific, and faster to
reinstall than to make portable.

## Layout

```text
/Volumes/T7/O.R.I.O.N. Models.sparsebundle
  mounts at /Volumes/ORION Models/
  ollama/
    blobs/
    manifests/
  huggingface/
    hub/
```

Ollama receives its path through an ORION-owned LaunchAgent and
`OLLAMA_MODELS`. Faster-whisper and Kokoro use compatibility links into the
shared Hugging Face cache, so existing workers do not need product-specific
storage logic.

## Install on a replacement Mac

1. Install Homebrew, Node, Python environments, FFmpeg, and Ollama.
2. Connect the T7 and confirm it mounts as `/Volumes/T7`.
3. Set `ORION_LOCAL_MODELS_ROOT=/Volumes/ORION Models`,
   `ORION_LOCAL_MODELS_BUNDLE_PATH=/Volumes/T7/O.R.I.O.N. Models.sparsebundle`,
   and `LOCAL_MODEL_STORAGE_EXPECTED=true` in `config/discord/.env`.
4. Run `npm run models:install -- --link-caches --activate`.
5. Run `npm run models:verify`.
6. Restart the Discord bot and run the health monitor.

For a fresh T7, run `npm run models:create-storage` once before copying model
data. The command refuses to overwrite an existing sparse bundle.

If the T7 is absent, model-dependent work must stop or defer. Lead management,
Discord, Supabase, and other non-model workflows remain independent.
