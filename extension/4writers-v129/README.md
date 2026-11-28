# Prowell 4Writers Watcher — v2.1.29.1

This is an **independent 4Writers-only** Chrome extension based on the **v2.1.29** four-site runtime, released separately from the live dual-platform bot. It has only two extension popup actions: **START WATCH** and **STOP**. It is packaged as `prowell-4writers-v2.1.29.1.zip` in the administrator-only Prowelljobs dashboard.

## Alternating refresh

The explicit cycle is **12, 3, 9, 5, 13, 4, 10, 7, 11, 6, 8 seconds**, repeating indefinitely. This covers every integer delay from 3 to 13 seconds exactly once. The next delay is computed from the stored refresh count, so reloading a page does not reset the sequence. START WATCH resets it to the beginning. This intentionally uneven sequence is deterministic, not randomized. It is not designed to conceal automation or bypass website protections.

The 4Writers account overview reloads its current URL after the chosen delay. On the Writings and Rewritings listings, the original v2.1.29 refresh controller switches between the website's own section links after the chosen delay and reloads only if a required section link cannot be found. When an order is present, the DOM observer stops the refresh immediately. Incomplete/blocked pages are never blindly reloaded. Delays are **scheduled waits**, not guarantees of wall-clock reload frequency; website page load and Chrome throttling add time.

## Order workflow

Available orders: request existing sound, cancel refresh, open **View**, confirm the matching Order ID, click **Take it**, allow the narrowly scoped site's **Are you sure?** confirmation, click **OK** once, and persist **STOP**. A one-use, time-limited marker then locates the unique visible **I understand** control and scrolls that control into view **without ever clicking it**. The user completes **I understand** manually.

Processing orders: original v2.1.29 behavior, sound → STOP → View once → scroll matching processing details to the bottom. It never takes a processing order.

Security warnings cause STOP without order actions. No challenge bypass or stealth features are included. A new START WATCH is required to resume after STOP. Simulated tests cannot guarantee assignment success or timing on the live website.

## Installation

Sign in to the [Prowelljobs admin dashboard](https://prowelljobs.com/admin) and click **Download 4Writers-only v2.1.29.1 ZIP**. Extract the ZIP and load the folder through `chrome://extensions` → Developer Mode → **Load unpacked**. Disable any other 4Writers automation extensions on the same browser tabs to avoid conflicting actions. This standalone extension uses its own `four_v129_` storage prefix and has **no Good-Writers host permission**.
