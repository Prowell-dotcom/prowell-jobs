# Prowell Dual-Platform Bot v2.1.13

## Source engines and changes

- **4writers:** user-supplied **v0.5.4** `content.js`,
  `order-card.js`, `confirm-main.js` and background logic are preserved
  unchanged in `legacy/four/`. Its original `refresh.js` is also preserved
  intact there as a backup.
- **Good-Writers:** user-supplied **v1.0.4** source remains preserved;
  the active dual runtime adds the final post-OK acknowledgement fix.
- Both sites have isolated `dual_four_` and `dual_good_` storage.
- The standalone `legacy-order-sound.js` plays one notification per newly
  seen available or processing order per START session. It never clicks.

### 4writers: Overview, Writings AND Rewritings

The dedicated 4writers refresh controller monitors all three visible
available-order surfaces without rewriting the original Take it workflow:

1. The extension recognizes both **Available Orders → Writings** and
   **Available Orders → Rewritings**, including the top navigation shown in
   the user's screenshots.
2. Once the visible order list is fully rendered, the controller checks that
   section and switches to the other through its **actual link**. It alternates
   sections approximately every **2 seconds** when idle and when the site
   responds normally. It never guesses hard-coded section URLs.
3. **Neutral Available Orders overview (neither tab selected):** the exact
   screenshot's blank middle with Writings/Rewritings links and sidebar is a
   third valid monitoring screen. It reloads its existing URL every **2 seconds**
   while armed and idle, even with no orders yet. It does not force a tab switch.
   New order cards on that overview are recognized by the original detector.
4. **A selected Writings or Rewritings tab still loading:** the controller
   waits for the order list to render before switching. This protects against
   reloading partially rendered lists; after 12 seconds it may retry loading.
5. Any detected available order stops section switching so the **original**
   `View → order details → Take it → OK → I understand` engine can act. A
   processing order uses only the original View/details preview.
6. It does not switch sections during an active claim, verification challenge
   or unrelated account page. Good-Writers section navigation is untouched.
7. Refresh diagnostics remain available in per-site storage; the compact
   popup deliberately shows only the two site headings and their START/STOP
   buttons. If a section link cannot be found, the bot records the reason
   instead of claiming both sections were monitored.

**Note:** Your original v0.5.4 script may resume monitoring after a successful
claim. This was kept intact because you asked to retain that original
order-handling engine. The dual refresh controller suspends while it is
processing an order.

### Gradual scrolling on both websites (only scrolling changed)

Both active dual engines scroll the selected order-information popup in **6
short increments**, adapting to the remaining scroll distance: **300ms** for
a near button (within one visible popup height), **500ms** for a medium
distance (within three heights), and **700ms** for a longer description. This applies to both available
orders and processing-order previews, and also the long post-OK
acknowledgement popup. The next Take it or I understand click happens only
after the gradual scroll finishes.

**Instant acceptance mode (v2.1.13):** After View, the bot jumps directly to
the bottom of the verified order details, then clicks Take it, OK, and the
final I understand button as soon as each control is available. The former
3/4/5-second staged delays and gradual scrolling are disabled. The bot
still pauses for real site rendering, respects security challenges and STOP,
and does not claim success without a website confirmation. The compact
popup still hides performance details. All other actions remain unchanged:
refreshing, sound, View, Take it, OK, acknowledgement, and reporting.

Background tab throttling or page rendering may change the actual scrolling
duration; the original per-site workflows and security checks remain in
place. Archived uploaded engine files remain unchanged.

### Final acknowledgement after OK — both websites

Both sites' original uploaded source files remain unchanged under `legacy/`.
Only their **active dual-extension** runtime wrappers have the final
acknowledgement fix:

- **4writers:** recognizes "I understand, take the order" and "I understand
  the order."
- **Good-Writers:** recognizes "I understand", "I understand, take the order"
  and "I understand the order."

After an order's **Take it → OK** sequence, the bot finds the acknowledgement
inside the displayed order-information dialog, jumps the dialog's **internal
scrolling content** to the bottom without scrolling the background document,
then clicks the visible acknowledgement button. Processing orders continue to
stop after View; the acknowledgement click is reserved for available-order
acceptance.

Both sites now have independent regression tests validating the post-OK
popup scroll, exact button labels, and final click.

### Service worker startup fix

The dual background worker is now **self-contained**, with both original
background-handler bodies and sound logic embedded directly. It uses no
`importScripts` dependencies, avoiding an additional extension registration
failure mode. Both background wrappers also use `globalThis.chrome` to
avoid the previous local-`chrome` initialization error. Automated tests
execute the entire worker and verify handler registration. Chrome still may
report other errors unrelated to these fixes; inspect the extension's
**Errors** panel for the exact message if registration fails.

## Installation

After ProwellJobs is deployed from the new repository commit, download
**Dual Bot v2.1.13** from the Prowell administrator dashboard. Remove/disable
the previous dual and separate bots, extract the new ZIP, and load the folder
containing `manifest.json` through `chrome://extensions` with Developer Mode
enabled. Reload the 4writers and Good-Writers site tabs. Press START separately
for each site. On 4writers, you may press START from the neutral Available Orders overview,
Writings or Rewritings; all three are supported.

CI validates startup, packaging and simulated behavior. Real-site navigation,
claim timing and availability still depend on the live account and browser;
an empty “None” order list is not itself a malfunction.

### Minimal popup in v2.1.9

The extension popup has exactly two visible site names, **4writers.net**
and **good-writers.com**, each with one **START AUTO-TAKE** button and
one **STOP** button. Detailed status reports, explanations, test sound
controls and performance statistics were removed from the **popup only**.
All original refresh, sound, View, gradual scrolling, Take it, OK, and final
acknowledgement scripts continue to run unchanged. START and STOP remain
independently scoped to each site. An invisible accessibility status
message provides button feedback without adding screen clutter.

### Compact quarter-size buttons (v2.1.8)

The dual popup is 248px wide rather than 490px, and each button is approximately 111 × 27px rather than 223 × 54px: about **one-quarter of the previous button area**. The site headings and labels are scaled proportionally. This release changes only popup styling; the automated order-handling engines, sound, refreshing, confirmation logic, and popup START/STOP handlers remain unchanged.

### Returning order IDs and faster smooth scroll (v2.1.9)

Previously stored attempted/completed/previewed IDs are now **history only**: they never prevent either site from opening a newly encountered order with the same ID. A new or processing order shown again after page reload, disappearance/reappearance, replacement of its View button, or owner START is eligible again. To prevent infinite duplicate clicks from MutationObserver, the exact same continuously present View element is handled only once per local appearance, and an active claim always blocks concurrent clicks. Processing orders continue to stop after View and scrolling, never Take it. The audio notifier also re-alerts when a new View element appears with a previously seen ID. Existing verification and claim-timeout safeguards remain intact.

Both sites' gradual scrolling still uses six visible increments, now spaced by 18 milliseconds, approximately 0.09 seconds per popup under normal foreground browser timing. This is a speed target, not a guarantee under browser throttling.

### 500 ms gradual scrolling (v2.1.13)

The active 4writers and Good-Writers order-details and final acknowledgement popups now scroll in **six visible positions over five 100 ms intervals**, totaling approximately **500 milliseconds per scroll** when browser timers run normally. The Take it and I understand actions still begin after their corresponding scroll completes; refreshing, notifications, repeated-order handling and other steps are unchanged. A full new-order acceptance includes up to two such scrolls and may exceed the earlier two-second target if website responses are slow. Browser throttling can also increase actual duration.

### Adaptive scroll timing (v2.1.13)

The dual bot measures the **remaining scroll distance** of each visible scrollable order-details panel relative to its visible height. If the target is within one popup-height, the motion takes **300 ms**; between one and three heights, **500 ms**; beyond three heights, **700 ms**. It keeps six smooth steps, waits for scrolling to finish, and only then proceeds to Take it. Good-Writers uses these same three categories for its post-OK acknowledgement.

**Special 4writers rule:** the *final* post-OK **I understand, take the order** acknowledgement popup always scrolls in **300 ms** regardless of length. This rule does not affect the first order-details popup. Processing orders use the same adaptive first-popup scrolling but do not click Take it. A zero-distance popup can proceed immediately because no scrolling is needed. Other steps, sound, refresh logic, same-ID reappearance handling, and the small popup controls are unchanged. Website load time and browser throttling can extend actual durations.

### Deliberate 3/4/5-second complete acceptance (v2.1.13)

On BOTH 4writers and Good-Writers, the first order-details popup determines the total schedule after **View**: **short = 3,000 ms**, **medium = 4,000 ms**, **long = 5,000 ms**. The automated workflow now spreads actions over that period rather than completing every click immediately: Take it no earlier than 40% of the target, OK at 72%, and I understand at 100%. The selected size and target are carried through every claim stage, including navigation and content updates. The final acknowledgement click cannot occur before its deadline. The website may respond too slowly to finish exactly on time, and the bot does not skip controls or bypass security checks to meet the target. Processing-order previews remain View → gradual scrolling → stop, not an acceptance flow. Restarted/returning orders remain eligible and the compact START/STOP buttons are unchanged.

### Instant order-taking and direct bottom jump (v2.1.13)

On both websites, order details and final acknowledgement popups **jump directly to the bottom** rather than scrolling in increments. No artificial waiting for Take it, OK or I understand remains. The bot clicks each real available control in sequence as soon as it appears. The former 3/4/5-second whole-flow pacing is disabled. The prior gradual-scrolling and timing sections above document older versions, not the current mode. Processing previews still perform only View → instant details jump → stop; they do not accept orders. Same-ID reappearance handling, scoped START/STOP buttons, security challenge checks, section refreshing and audible notifications remain unchanged. A website that loads buttons slowly can still delay completion.
