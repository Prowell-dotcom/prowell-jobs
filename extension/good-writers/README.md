# Good-Writers Standalone Watcher — v1.0.17

This is the **separate Good-Writers Chrome extension**. It does not modify the 4Writers-only bot or the newer dual-platform bot. It has two controls: **START WATCH** and **STOP**.

## Monitoring and actions

On a Good-Writers Available Orders listing with no new order, schedule a page refresh **every 2,000 milliseconds**. The DOM MutationObserver watches continuously between reloads. Browser throttling, network delays, and page load times can lengthen the actual interval.

As soon as a valid available or processing order is displayed, the active content script:

1. Cancels its refresh timer and disarms locally.
2. Requests the existing audible notification.
3. Persists a STOP state in Chrome storage before the View click.
4. Clicks the order's **View** control **once**, if still connected.
5. Remains stopped until the user manually presses **START WATCH** again.

The extension **does not** click Take it, OK, or I understand; it never scrolls or accepts an order. It also stops without clicking when a recognized security warning appears. The previous auto-accept and confirmation scripts are not injected or included in the admin ZIP.

## Installation

Open the [Prowelljobs administrator dashboard](https://prowelljobs.com/admin), choose **Download Good-Writers Assistant ZIP**, extract the archive, and load the folder in Chrome at `chrome://extensions` using **Load unpacked**. Remove or disable the earlier Good-Writers extension version and avoid running overlapping monitoring extensions on the same site tab.

Dedicated regression tests cover the 2-second timer, notification and STOP-before-View, the single View click for both order types, warning shutdown, manual restart, and the separate ZIP contents. These are simulated tests; live-site success and exact response timing are not guaranteed.
