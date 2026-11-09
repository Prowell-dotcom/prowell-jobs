# Prowell Dual-Platform Bot v2.1.6

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
7. The extension popup reports the last checked section and the number of
   section checks. If the site does not expose the Writings/Rewritings links,
   it explicitly reports that navigation could not be found instead of
   claiming that both are being monitored.

**Note:** Your original v0.5.4 script may resume monitoring after a successful
claim. This was kept intact because you asked to retain that original
order-handling engine. The dual refresh controller suspends while it is
processing an order.

### Gradual scrolling on both websites (only scrolling changed)

Both active dual engines scroll the selected order-information popup in **6
short increments** (approximately 0.14 seconds total when the browser runs
timers normally) instead of jumping instantly. This applies to both available
orders and processing-order previews, and also the long post-OK
acknowledgement popup. The next Take it or I understand click happens only
after the gradual scroll finishes.

**Post-View speed target:** The available-order workflow aims to complete
View → smooth scroll → Take it → OK → smooth scroll → I understand in
**2 seconds** after View when the website displays its controls promptly.
The steps are triggered by real page readiness, not a forced timer. The
popup reports the actual View-to-last-action duration and whether it met
the 2-second target. Slow website loading, network responses, and
background-tab timer throttling can exceed 2 seconds. The extension does
not click buttons that are missing or claim success before website
confirmation. All other actions remain unchanged:
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
**Dual Bot v2.1.6** from the Prowell administrator dashboard. Remove/disable
the previous dual and separate bots, extract the new ZIP, and load the folder
containing `manifest.json` through `chrome://extensions` with Developer Mode
enabled. Reload the 4writers and Good-Writers site tabs. Press START separately
for each site. On 4writers, you may press START from the neutral Available Orders overview,
Writings or Rewritings; all three are supported.

CI validates startup, packaging and simulated behavior. Real-site navigation,
claim timing and availability still depend on the live account and browser;
an empty “None” order list is not itself a malfunction.
