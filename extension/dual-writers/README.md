# Prowell Dual-Platform Instant Bot (v2.0.4)

The combined Chrome/Edge Manifest V3 extension monitors **4writers.net** and
**good-writers.com** independently. Use only the dual bot if you want both
sites; disable older 4writers and Good-Writers single-site extensions.

## Installation
Download the dual-platform bot ZIP after the latest ProwellJobs deployment
from your signed-in ProwellJobs administrator dashboard. Extract the ZIP.
Open `chrome://extensions`, enable Developer mode and choose **Load unpacked**,
selecting the folder with `manifest.json`. Reload the order pages as well.

## What START AUTO-TAKE does
- START separately for 4writers and Good-Writers. Each site has its own state,
  target tab, order history, notification sound and STOP button.
- Both Available Orders and Processing Orders lists are monitored with the
  existing one-second reload interval when it is safe to refresh. Browser
  background throttling and site delays may increase actual intervals.
- Upon detection of a new order ID: synchronously cancel the refresh timer,
  immediately request an audible notification and click **View** without
  waiting for sound playback or a storage-write callback.
- On the selected order details, jump once and instantly to the bottom of the
  **actual order-details scrolling pane**, not the page behind it.
- An AVAILABLE order card has **Files + View**. After scrolling, click
  **Take it**, then **OK**, then **I understand** as each control becomes
  available. No fixed sleeps or gradual scrolling.
- A PROCESSING order card has **Files + Messages + View**. It is already
  assigned and normally has **no Take it**. The bot performs the exact same
  detection, notification, View and scroll steps and then finishes that
  processing preview successfully. **Never search endlessly or click OK/I
  understand when Take it is absent.**
- A processing preview records PASS/FAIL in the dual extension popup. A
  processing preview is a test of detection, sound, View and scroll, **not**
  a real test of the availability-only Take it / confirmation flow.
- Already-detected order IDs are skipped until a new START session to avoid
  repeated notifications and accidental duplicate actions.
- The workflow returns control to the site after completion and resumes
  monitoring once its details are closed and a supported orders list is open.
- STOP turns off all automatic acceptance for its selected site. A security
  challenge, ambiguity or unexpected controls stop that order's action flow.

## Performance and limits
The target is immediate, event-driven interaction with no intentional click
pauses. **One-second completion cannot be guaranteed** due to network latency,
page transitions, browser scheduling, sound permission or website response.
The extension never bypasses CAPTCHAs and never requests website passwords.
A green automated test run does not prove successful acceptance of a live
third-party order; verify real assignment status directly on the website.
