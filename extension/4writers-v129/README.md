# Prowell 4Writers Watcher — v2.1.29.5

This is an **independent 4Writers-only** Chrome extension based on the **v2.1.29** four-site runtime, released separately from the live dual-platform bot. It has only two extension popup actions: **START WATCH** and **STOP**. It is packaged as `prowell-4writers-v2.1.29.5.zip` in the administrator-only Prowelljobs dashboard.

## Alternating refresh

The explicit cycle is **30 → 7 → 24 → 3 → 18 → 11 → 27 → 5 → 15 → 2 → 22 → 9 → 29 → 4 → 13 → 6 → 25 → 10 → 17 → 8 seconds**, then repeats. Every programmed wait is between **2 and 30 seconds**, and shorter intervals occur infrequently. This is a fixed schedule for predictable testing, not an attempt to evade website monitoring. This is a fixed, testable operational sequence—not random or designed to evade detection. The next delay is based on the stored refresh count, so page reloads do not restart the sequence. START WATCH resets it to 30 seconds.

The 4Writers account overview reloads its current URL after the chosen delay. On the Writings and Rewritings listings, the original v2.1.29 refresh controller switches between the website's own section links after the chosen delay and reloads only if a required section link cannot be found. When an order is present, the DOM observer stops the refresh immediately. Incomplete/blocked pages are never blindly reloaded. Delays are **scheduled waits**, not guarantees of wall-clock reload frequency; website page load and Chrome throttling add time. If a link-click fails, the controller schedules another ordinary interval instead of silently stopping; on browser pageshow it also rechecks whether the watcher remains armed. Security warnings still force STOP.

## Order workflow

Available orders: request existing sound, cancel refresh, open **View**, confirm the matching Order ID, click **Take it**, allow the narrowly scoped site's **Are you sure?** confirmation, click **OK** once, and persist **STOP**. A one-use, time-limited marker then locates the unique visible **I understand** control, scrolls to it and **clicks it automatically exactly once**. To prevent duplicate final acknowledgements after navigation or repeated DOM changes, the bot clears the pending acknowledgement in Chrome storage **before the click**. The bot remains STOPPED; it does not restart automatically. If the acknowledgement is absent, ambiguous, blocked, or expired, it stops and leaves remaining actions manual. Clicking a browser control does not guarantee the website assigned the order.

Processing orders: original v2.1.29 behavior, sound → STOP → View once → scroll matching processing details to the bottom. It never takes a processing order.

Security warnings cause STOP without order actions. No challenge bypass or stealth features are included. A new START WATCH is required to resume after STOP. Simulated tests cannot guarantee assignment success or timing on the live website.

## Installation

Sign in to the [Prowelljobs admin dashboard](https://prowelljobs.com/admin) and click **Download 4Writers-only v2.1.29.5 ZIP**. Extract the ZIP and load the folder through `chrome://extensions` → Developer Mode → **Load unpacked**. Disable any other 4Writers automation extensions on the same browser tabs to avoid conflicting actions. This standalone extension uses its own `four_v129_` storage prefix and has **no Good-Writers host permission**.
