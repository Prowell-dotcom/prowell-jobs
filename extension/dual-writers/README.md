# Prowell Dual-Platform Bot v2.1.3

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

### 4writers: Writings AND Rewritings

The dedicated 4writers refresh controller adds support for both
available-order sections without rewriting the original Take it workflow:

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
**Dual Bot v2.1.3** from the Prowell administrator dashboard. Remove/disable
the previous dual and separate bots, extract the new ZIP, and load the folder
containing `manifest.json` through `chrome://extensions` with Developer Mode
enabled. Reload the 4writers and Good-Writers site tabs. Press START separately
for each site. On 4writers, open Available Orders → Writings or Rewritings
before START.

CI validates startup, packaging and simulated behavior. Real-site navigation,
claim timing and availability still depend on the live account and browser;
an empty “None” order list is not itself a malfunction.
