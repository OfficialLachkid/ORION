#!/usr/bin/env python3

import argparse
import json
import os
import re
import sys
from pathlib import Path


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="hexgrad/Kokoro-82M")
    parser.add_argument("--voice", default="am_fenrir")
    parser.add_argument("--output-file")
    parser.add_argument("--cache-dir")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--prosody-mode", choices=("full_context", "sentence_isolated"), default="full_context")
    parser.add_argument("--sentence-pause-ms", type=int, default=0)
    parser.add_argument("--check-runtime", action="store_true")
    return parser


def split_sentences(text):
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text.strip()) if part.strip()]


def main():
    args = build_parser().parse_args()
    if args.cache_dir:
        cache_dir = str(Path(args.cache_dir).resolve())
        os.environ["HF_HOME"] = cache_dir
        os.environ["HUGGINGFACE_HUB_CACHE"] = str(Path(cache_dir) / "hub")

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    if args.check_runtime:
        sys.stdout.write(json.dumps({"status": "ready", "provider": "kokoro"}))
        return
    if not args.output_file:
        raise ValueError("--output-file is required for synthesis")

    text = sys.stdin.read().strip()
    if not text:
        raise ValueError("Narration text is required on stdin")

    pipeline = KPipeline(lang_code="a", repo_id=args.model, device="cpu")
    segments = [text] if args.prosody_mode == "full_context" else split_sentences(text)
    silence = np.zeros(round(24000 * args.sentence_pause_ms / 1000), dtype=np.float32)
    output_parts = []
    for segment_index, segment in enumerate(segments):
        generated_parts = [
            np.asarray(audio, dtype=np.float32)
            for _, _, audio in pipeline(
                segment,
                voice=args.voice,
                speed=args.speed,
                split_pattern=None,
            )
        ]
        if not generated_parts:
            raise RuntimeError(f"Kokoro produced no audio for segment {segment_index + 1}")
        output_parts.extend(generated_parts)
        if segment_index < len(segments) - 1 and len(silence) > 0:
            output_parts.append(silence)

    output_path = Path(args.output_file).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, np.concatenate(output_parts), 24000, subtype="PCM_16")


if __name__ == "__main__":
    main()
