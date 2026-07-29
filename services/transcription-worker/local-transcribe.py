#!/usr/bin/env python3

import argparse
import json
import math
import sys

from faster_whisper import WhisperModel


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model", default="medium")
    parser.add_argument("--language", default="")
    parser.add_argument("--word-timestamps", action="store_true")
    parser.add_argument("--disable-vad-filter", action="store_true")
    return parser


def confidence_from_avg_logprob(avg_logprob):
    try:
        return clamp(math.exp(avg_logprob), 0.0, 1.0)
    except Exception:
        return 0.0


def main():
    args = build_parser().parse_args()
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.audio_path,
        beam_size=1,
        vad_filter=not args.disable_vad_filter,
        word_timestamps=args.word_timestamps,
        language=args.language or None,
        condition_on_previous_text=False,
    )

    transcript_parts = []
    logprobs = []
    segment_count = 0
    words = []
    duration_seconds = 0.0

    for segment in segments:
        segment_count += 1
        text = (segment.text or "").strip()
        if text:
            transcript_parts.append(text)
        if getattr(segment, "avg_logprob", None) is not None:
            logprobs.append(segment.avg_logprob)
        duration_seconds = max(duration_seconds, float(getattr(segment, "end", 0.0) or 0.0))

        if args.word_timestamps:
            for word in getattr(segment, "words", None) or []:
                value = (getattr(word, "word", "") or "").strip()
                if not value:
                    continue
                start = max(0.0, float(getattr(word, "start", 0.0) or 0.0))
                end = max(start, float(getattr(word, "end", start) or start))
                duration_seconds = max(duration_seconds, end)
                words.append({
                    "start": start,
                    "end": end,
                    "word": value,
                    "probability": clamp(float(getattr(word, "probability", 0.0) or 0.0), 0.0, 1.0),
                })

    transcript = " ".join(part for part in transcript_parts if part).strip()
    avg_logprob = sum(logprobs) / len(logprobs) if logprobs else -2.0
    confidence = confidence_from_avg_logprob(avg_logprob)

    payload = {
        "transcript": transcript,
        "confidence": confidence,
        "language": getattr(info, "language", ""),
        "segmentCount": segment_count,
        "durationSeconds": duration_seconds,
        "words": words,
        "warnings": [],
    }

    sys.stdout.write(json.dumps(payload))


if __name__ == "__main__":
    main()
