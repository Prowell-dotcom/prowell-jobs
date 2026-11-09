# Prowell Dual-Platform Bot v2.1.0 — ORIGINAL engines + audio

This is a combined extension built from the **exact earlier files** supplied
by the owner:

- **4writers:** v0.5.4 scripts.
- **Good-Writers:** v1.0.4 scripts.

All original files are preserved unchanged under `legacy/four/` and
`legacy/good/` in the GitHub source. The original `content.js`, `refresh.js`
and `background.js` source bodies are embedded **without edits** in the
corresponding `runtime-*.js` files. The runtime wrappers give each site its
own `dual_four_` or `dual_good_` Chrome storage keys so their settings and
claims cannot overwrite one another.

The original `order-card.js` and `confirm-main.js` are loaded directly
without edits. The original site background logic (including reporting and
new-tab handoff) runs through isolated compatibility wrappers.

The dual popup is a combined START/STOP interface rather than either
standalone popup. START for 4writers arms legacy consent version `0.5.4`;
START for Good-Writers arms legacy consent version `1.0.4`.

## Only added order action feature: audible notification

`legacy-order-sound.js` observes **available AND processing** cards before
the original order-handling scripts act. It requests the chime immediately,
once per detected order ID in each START session. It never scrolls, refreshes,
clicks View, Take it, OK or I understand, and does not change the workflow.

The original scripts retain their original behaviors: **2-second refresh
interval**, order detection, View, modal-aware scrolling, Take it, OK,
acknowledgement and processing preview. They are not replaced by the newer
dual-bot scroll/auto-accept implementation. The original 4writers and
Good-Writers source includes safeguards against challenges.

**Important:** Unlike the recent experimental dual bot, the original
available-order engines can resume watching after successful processing.
Processing previews disarm automatically. This is intentional: the user
explicitly requested the exact earlier code with only a sound addition.

## Installation

Download the new combined ZIP after ProwellJobs deploys this GitHub commit
from the administrator dashboard. Extract the ZIP. Disable or remove older
unpacked combined and single-site extensions before loading this one. Open
`chrome://extensions`, enable Developer mode, select **Load unpacked**, and
choose the folder containing this ZIP's `manifest.json`. Reload both
official website tabs. Press START separately for each site in the dual popup.

A green automated test validates code packaging and simulated notifications,
not the result of a real order acceptance. Network latency and browser
background throttling cannot guarantee a one-second claim.
