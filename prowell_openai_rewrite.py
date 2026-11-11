"""Cost-bounded OpenAI rewriting for Prowell's public Humanizer.

An owner-controlled opt-in provider. Never expose credentials or source text
in error logs. A successful provider request still requires factual validation.
"""
import os
import threading
import time
import re

import admin_paraphraser as core
import prowell_deeprewrite as checks

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
    if not isinstance(draft, str):
        return False
    if not core._safe_output(original, draft, terms):
        return False
    if not core._safe_output(current, draft, terms):
        return False
    if not checks._same_named_content(original, draft):
        return False
    if not checks._claims_and_tense_preserved(original, draft):
        return False
    if not .72 * core.count_words(original) <= core.count_words(draft) <= 1.36 * core.count_words(original):
        return False
    if (checks.Counter(checks._NEGATION.findall(original.lower())) !=
            checks.Counter(checks._NEGATION.findall(draft.lower()))):
        return False
    if checks._naturalness(draft) < .55:
        return False
    if any(" ".join(draft.lower().split()) == " ".join(h.lower().split())
           for h in history):
        return False
    if core._rewrite_edit_metrics(original, draft, terms)["editableTextChangePercent"] < 18:
        return False
    return True


def rewrite(source, original, tone, level, terms=(), history=(), attempt=0):
    if not enabled():
        raise ProviderUnavailable(
            "OpenAI editing is not configured or enabled by the website owner."
        )
    if core.count_words(source) > MAX_WORDS or core.count_words(original) > MAX_WORDS:
        raise ValueError("OpenAI rewriting currently supports up to 350 words per request.")
    _reserve()
    try:
        api_key = os.environ["OPENAI_API_KEY"].strip()
        model = os.getenv("PROWELL_OPENAI_MODEL", "gpt-4.1-mini").strip()
        if not re.fullmatch(r"[a-zA-Z0-9._-]{2,80}", model):
            raise ProviderUnavailable("OpenAI model setting is invalid.")
        style = core.TONES[tone]
        instruction = (
            "You are a careful writing editor. Reconstruct sentences and clauses "
            "in fluent, natural English. Retain all original factual claims, "
            "names, numerical values, references, quotations, negations, verb "
            "tenses, event ordering and author certainty. Do not introduce facts, "
            "claim results, or alter medical details. Avoid superficial synonym "
            "swaps and awkward expressions. Do not discuss AI detection. "
            "Return ONLY the complete revised text, without commentary. "
            "Use this writing style: " + style
        )
        if terms:
            instruction += "\nPreserve these exact terms: " + repr(list(terms))
        prompt = "<source>\n" + source + "\n</source>"
        best = None
        for index in range(2):
            if index:
                revision = instruction + (
                    "\nRETRY: The previous rewrite failed a preservation or "
                    "variation check. Preserve original facts and grammatical "
                    "tense exactly while varying sentence structures."
                )
            else:
                revision = instruction
            try:
                candidate = core._request_rewrite(api_key, model, revision, prompt)
            except RuntimeError as exc:
                # Do not leak a key or provider response to end users.
                raise ProviderUnavailable(str(exc)) from None
            if _valid(original, source, candidate, terms, history):
                best = candidate.strip()
                break
        if best is None:
            raise ProviderUnavailable(
                "OpenAI generated text, but no version passed the factual and "
                "writing-quality checks. Your original text was preserved."
            )
        return {
            "paraphrased": best,
            "candidateCount": index + 1,
            "validCandidateCount": 1,
            "verificationMethods": [
                "protected details", "role and tense checks",
                "negation and uncertainty", "basic fluency checks",
                "minimum substantive variation"
            ],
            "enginePipeline": "openai_editorial_verified",
            "editorialPass": "validated",
        }
    finally:
        _release()
