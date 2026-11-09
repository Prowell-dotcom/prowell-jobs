# Prowell Dual-Platform Instant Bot (v2.0.0)

This is a separate Chrome/Edge Manifest V3 extension. It monitors **4writers.net**
and **good-writers.com** independently using one browser extension.

## Install
From the signed-in Prowell Jobs administrator dashboard, download the
Dual-Platform Instant Bot ZIP. Extract it, then choose **Load unpacked** in
`chrome://extensions` and select the extracted folder containing `manifest.json`.

**Stop or disable the older single-site order extensions** before running this
one on the same tabs. Multiple bots attempting to claim the same order can race.

## Operation
- Log into each official site in its own tab.
- In the extension popup, press **START** for each platform you want to monitor.
- Each site has a separate armed state, selected tab, order workflow and opt-in.
- Monitor pages reload every 1 second while they have no eligible orders.
- On detection: stop the matching site's monitor, alert, open **View**, and
  instantly jump to the bottom of the actual order-details scrolling container.
- Available orders proceed through **Take It → OK → I Understand** only after
  separate explicit per-session consent for that site. Processing orders never
  auto-accept.
- No artificial sleeps, gradual scrolling, or pre-click delays in the acceptance path.
  It reacts to DOM changes; actual site/network response times remain variable.
- Any security challenge or ambiguous control stops the workflow.

The extension never asks for credentials and does not bypass site security.
Live third-party acceptance behavior must be verified on the sites.
