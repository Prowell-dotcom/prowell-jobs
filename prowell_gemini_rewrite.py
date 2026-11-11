"""Owner-enabled, rate-limited Gemini alternative to the OpenAI Humanizer.

Never silently send a visitor's text to Gemini. The public UI exposes an
explicit provider option and states that Google will process that text.
"""
import os
import re
import threading
import time

import admin_paraphraser as core
import prowell_openai_rewrite as checks

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
    if not enabled():
        raise GeminiUnavailable("Gemini editing is not enabled by the website owner.")
    if core.count_words(source) > MAX_WORDS or core.count_words(original) > MAX_WORDS:
        raise ValueError("Gemini editing supports up to 350 words per request.")
    _reserve()
    try:
        model = os.getenv("PROWELL_GEMINI_MODEL", "gemini-3.8-flash").strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]{5,120}", model):
            raise GeminiUnavailable("Gemini model configuration is invalid.")
        style = core.TONES[tone]
        instructions = (
            "Rewrite the passage in fluent, natural English using meaningful "
            "structural changes, without adding or changing claims. Preserve "
            "numbers, exact dates, names, citations, quotations, negations, "
            "medical terminology, tense and degree of certainty. Do not "
            "invent outcomes or omit factual details. Avoid mechanical "
            "synonym replacement. Return only the rewritten text. "
            "Requested style: " + style
        )
        if terms:
            instructions += "\nProtected terms to preserve exactly: " + repr(list(terms))
        prompt = "<source>\n" + source + "\n</source>"
        candidate_count = 0
        for round_index in range(2):
            retry_notes = (
                "\nTry a different sentence structure, but be especially "
                "careful about every factual detail and original verb tense."
                if round_index else ""
            )
            try:
                candidate = core._request_gemini(
                    os.environ["GEMINI_API_KEY"].strip(), model,
                    instructions + retry_notes, prompt
                )
            except RuntimeError as exc:
                # Existing provider function sanitizes HTTP errors and never
                # includes the key or submitted text in its exceptions.
                raise GeminiUnavailable(str(exc)) from None
            candidate_count += 1
            if checks._valid(original, source, candidate, terms, history):
                return {
                    "paraphrased": candidate.strip(),
                    "candidateCount": candidate_count,
                    "validCandidateCount": 1,
                    "enginePipeline": "gemini_editorial_verified",
                    "editorialPass": "validated",
                    "verificationMethods": [
                        "protected details", "role and tense checks",
                        "negation and uncertainty", "fluency checks",
                        "minimum substantive variation"
                    ],
                }
        raise GeminiUnavailable(
            "Gemini returned text, but no version passed the accuracy and "
            "writing-quality checks. Your original text was preserved."
        )
    finally:
        _release()
