"""Owner-enabled, rate-limited Gemini alternative to the OpenAI Humanizer.

Never silently send a visitor's text to Gemini. The public UI exposes an
explicit provider option and states that Google will process that text.
"""
import os
import re
import threading
import time

import admin_paraphraser as core
import prowell_rewrite_quality as quality

MAX_WORDS = 350
_LOCK = threading.Lock()
_WINDOW_STARTED = time.monotonic()
_USED = 0
_IN_FLIGHT = False


class GeminiUnavailable(RuntimeError):
    pass


def enabled():
    return (
        os.getenv("PROWELL_PUBLIC_GEMINI_ENABLED", "").lower() in ("1", "yes", "true")
        and bool(os.getenv("GEMINI_API_KEY", "").strip())
    )


def capabilities():
    return {"geminiAvailable": enabled(), "geminiMaxWords": MAX_WORDS}


def _reserve():
    global _WINDOW_STARTED, _USED, _IN_FLIGHT
    with _LOCK:
        now = time.monotonic()
        if now - _WINDOW_STARTED >= 86400:
            _WINDOW_STARTED, _USED = now, 0
        limit = max(1, min(100, int(os.getenv("PROWELL_GEMINI_DAILY_LIMIT", "10"))))
        if _USED >= limit:
            raise GeminiUnavailable("Gemini daily usage limit reached. Please try later.")
        if _IN_FLIGHT:
            raise GeminiUnavailable("Gemini editing is busy. Please try shortly.")
        _USED += 1
        _IN_FLIGHT = True


def _release():
    global _IN_FLIGHT
    with _LOCK:
        _IN_FLIGHT = False


def rewrite(source, original, tone, level, terms=(), history=(), attempt=0):
    """Edit with a bounded Gemini request and retain the best valid version."""
    if not enabled():
        raise GeminiUnavailable("Gemini editing is not enabled by the website owner.")
    if core.count_words(source) > MAX_WORDS or core.count_words(original) > MAX_WORDS:
        raise ValueError("Gemini editing supports up to 350 words per request.")
    level = min(10, max(1, int(level)))
    _reserve()
    try:
        model = os.getenv("PROWELL_GEMINI_MODEL", "gemini-3.8-flash").strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{5,120}", model):
            raise GeminiUnavailable("Gemini model configuration is invalid.")
        prompt = "<source>\n" + source + "\n</source>"
        reason = ""
        attempts = 0
        best = None
        for index in range(2):
            instruction = quality.instructions(
                tone, level, terms, retry=bool(index), reason=reason
            )
            try:
                candidate = core._request_gemini(
                    os.environ["GEMINI_API_KEY"].strip(), model,
                    instruction, prompt
                )
            except RuntimeError as exc:
                if best is not None:
                    break  # Preserve a good draft even when a later pass fails.
                raise GeminiUnavailable(str(exc)) from None
            attempts += 1
            decision = quality.evaluate(original, source, candidate, terms, history, level)
            if decision["passed"]:
                if best is None or decision["score"] > best["score"]:
                    best = decision
                if level < 9 or best["score"] >= .77:
                    break
                reason = "fluency"
            else:
                reason = decision["reason"]
        if best is None:
            raise GeminiUnavailable(
                "Gemini generated a draft, but no version passed the accuracy "
                "and writing-quality checks. Your original text was preserved."
            )
        return {
            "paraphrased": best["text"],
            "candidateCount": attempts,
            "validCandidateCount": 1,
            "enginePipeline": "gemini_level_aware_editorial",
            "editorialPass": "quality_ranked",
            "verificationMethods": [
                "exact protected details", "named entities",
                "actor, event and tense checks", "negation and uncertainty",
                "fluency and meaningful structural variation",
            ],
        }
    finally:
        _release()
