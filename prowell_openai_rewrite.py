"""Cost-bounded OpenAI rewriting for Prowell's public Humanizer.

An owner-controlled opt-in provider. Never expose credentials or source text
in error logs. A successful provider request still requires factual validation.
"""
import os
import threading
import time
import re

import admin_paraphraser as core
import prowell_rewrite_quality as quality

MAX_WORDS = 350
_LOCK = threading.Lock()
_WINDOW_STARTED = time.monotonic()
_USED = 0
_IN_FLIGHT = False


class ProviderUnavailable(RuntimeError):
    pass


def enabled():
    return (
        os.getenv("PROWELL_PUBLIC_OPENAI_ENABLED", "").lower() in ("1", "true", "yes")
        and bool(os.getenv("OPENAI_API_KEY", "").strip())
    )


def capabilities():
    return {
        "openaiAvailable": enabled(),
        "openaiMaxWords": MAX_WORDS,
        "openaiStatus": "configured" if enabled() else "not_configured",
    }


def _reserve():
    global _WINDOW_STARTED, _USED, _IN_FLIGHT
    with _LOCK:
        now = time.monotonic()
        if now - _WINDOW_STARTED >= 86400:
            _WINDOW_STARTED, _USED = now, 0
        # Bounded per-process daily quota and single concurrent paid request.
        # Multi-replica deployment requires a shared Redis/database quota.
        limit = max(1, min(100, int(os.getenv("PROWELL_OPENAI_DAILY_LIMIT", "20"))))
        if _USED >= limit:
            raise ProviderUnavailable(
                "OpenAI daily usage limit reached. Please try again later."
            )
        if _IN_FLIGHT:
            raise ProviderUnavailable(
                "OpenAI editing is currently busy. Please try again shortly."
            )
        _USED += 1  # Reserve for the whole request, including at most one retry.
        _IN_FLIGHT = True


def _release():
    global _IN_FLIGHT
    with _LOCK:
        _IN_FLIGHT = False


def _valid(original, current, draft, terms, history):
    """Backward-compatible boolean check for callers of the earlier editor."""
    return quality.evaluate(original, current, draft, terms, history, 9)["passed"]

def rewrite(source, original, tone, level, terms=(), history=(), attempt=0):
    """Use level-aware prompts; retain the best fact-checked draft on retry."""
    if not enabled():
        raise ProviderUnavailable(
            "OpenAI editing is not configured or enabled by the website owner."
        )
    if core.count_words(source) > MAX_WORDS or core.count_words(original) > MAX_WORDS:
        raise ValueError("OpenAI rewriting currently supports up to 350 words per request.")
    level = min(10, max(1, int(level)))
    _reserve()
    try:
        api_key = os.environ["OPENAI_API_KEY"].strip()
        model = os.getenv("PROWELL_OPENAI_MODEL", "gpt-4.1-mini").strip()
        if not re.fullmatch(r"[a-zA-Z0-9._-]{2,80}", model):
            raise ProviderUnavailable("OpenAI model setting is invalid.")
        prompt = "<source>\n" + source + "\n</source>"
        best = None
        reason = ""
        attempts = 0
        for index in range(2):
            instruction = quality.instructions(
                tone, level, terms, retry=bool(index), reason=reason
            )
            try:
                candidate = core._request_rewrite(api_key, model, instruction, prompt)
            except RuntimeError as exc:
                if best is not None:
                    break  # Never discard a valid first draft if polish fails.
                raise ProviderUnavailable(str(exc)) from None
            attempts += 1
            decision = quality.evaluate(original, source, candidate, terms, history, level)
            if decision["passed"]:
                if best is None or decision["score"] > best["score"]:
                    best = decision
                # High-intensity work gets a second option only if the
                # first is below the editorial quality heuristic.
                if level < 9 or best["score"] >= .77:
                    break
                reason = "fluency"
            else:
                reason = decision["reason"]
        if best is None:
            raise ProviderUnavailable(
                "OpenAI generated a draft, but no version passed the accuracy "
                "and writing-quality checks. Your original text was preserved."
            )
        return {
            "paraphrased": best["text"],
            "candidateCount": attempts,
            "validCandidateCount": 1,
            "verificationMethods": [
                "exact protected details", "named entities",
                "actor, event and tense checks", "negation and uncertainty",
                "fluency and meaningful structural variation",
            ],
            "enginePipeline": "openai_level_aware_editorial",
            "editorialPass": "quality_ranked",
        }
    finally:
        _release()
