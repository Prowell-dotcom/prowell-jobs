# Prowell Dual-Platform Bot v2.1.1

## Source engines and changes

- **4writers:** user-supplied **v0.5.4** `content.js`,
  `order-card.js`, `confirm-main.js` and background logic are preserved
  unchanged in `legacy/four/`. Its original `refresh.js` is also preserved
  intact there as a backup.
- **Good-Writers:** user-supplied **v1.0.4** foreground, background,
  `refresh.js`, click and confirmation engines remain unchanged.
- Both sites have isolated `dual_four_` and `dual_good_` storage.
- The standalone `legacy-order-sound.js` plays one notification per newly
  seen available or processing order per START session. It never clicks.

### 4writers: Writings AND Rewritings

The only changed 4writers behavior in this release is the **dual-extension
refresh controller** (not the original order-taking script):

1. The extension recognizes both **Available Orders → Writings** and
   **Available Orders → Rewritings**, including the top navigation shown in
   the user's screenshots.
2. Once the visible order list is fully rendered, the controller checks that
   section and switches to the other through its **actual link**. It alternates
   sections approximately every **2 seconds** when idle and when the site
   responds normally. It never guesses hard-coded section URLs.
3. If the website is showing only the header/sidebar with a blank main content
   area, it waits for the list to load. After 12 seconds of incomplete loading,
   it may retry the page load; it never reloads a blank page every 2 seconds.
4. Any detected available order stops section switching so the **original**
   `View → order details → Take it → OK → I understand` engine can act. A
   processing order uses only the original View/details preview.
5. It does not switch sections during an active claim, verification challenge
   or unrelated account page. Good-Writers section navigation is untouched.
6. The extension popup reports the last checked section and the number of
   section checks. If the site does not expose the Writings/Rewritings links,
   it explicitly reports that navigation could not be found instead of
   claiming that both are being monitored.

**Note:** Your original v0.5.4 script may resume monitoring after a successful
claim. This was kept intact because you asked to retain that original
order-handling engine. The dual refresh controller suspends while it is
processing an order.

### Service worker startup fix

The previous dual build had a background-script initialization error:
`const rawChrome=chrome` read the name `chrome` before a local `const
chrome` was initialized. Both background wrappers now obtain the browser API
via `globalThis.chrome`. A regression test executes the **complete** service
worker imports to catch this startup error, rather than only syntax-checking
them. Chrome's `service worker (Inactive)` label can be normal when idle;
the **Errors** detail panel is where actual errors are shown.

## Installation

After ProwellJobs is deployed from the new repository commit, download
**Dual Bot v2.1.1** from the Prowell administrator dashboard. Remove/disable
the previous dual and separate bots, extract the new ZIP, and load the folder
containing `manifest.json` through `chrome://extensions` with Developer Mode
enabled. Reload the 4writers and Good-Writers site tabs. Press START separately
for each site. On 4writers, open Available Orders → Writings or Rewritings
before START.

CI validates startup, packaging and simulated behavior. Real-site navigation,
claim timing and availability still depend on the live account and browser;
an empty “None” order list is not itself a malfunction.
