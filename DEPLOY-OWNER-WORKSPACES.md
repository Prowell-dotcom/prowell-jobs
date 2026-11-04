# Prowell Jobs — Owner Admin + Member Writing Workspaces

This is a production **upgrade patch** for the existing Prowell Jobs Python/SQLite/Railway application at `https://prowelljobs.com`. It keeps the existing job board, registered members, vacancy moderation, and the **working `notifications.py` Resend adapter**.

## What changes

- A **single public Sign up / Log in page** remains for job seekers, employers, writing clients, and writers. No regular member can sign up as Admin.
- The same account page now offers an **Administrator** tab. Before any owner exists, it shows a one-time owner-setup form protected by the existing Railway `ADMIN_KEY`. This key must stay private.
- The first successful setup creates exactly one owner record in your existing SQLite database and invalidates previous key-only admin sessions. Afterward, setup is permanently closed (`409` on any further attempt), and the tab shows **Administrator login** using the new owner email and password. Normal member logins remain separate.
- After creating the owner, the old direct `ADMIN_KEY` login and legacy Bearer admin API access are disabled. Keep `ADMIN_KEY` set in Railway because it protects setup and session fingerprinting.
- The administrator can compare real bids on open writing requests and **select a writer**. The client can still choose from bids. Every assignment is audited and immediately closes competing bids.
- Clients can submit a public project summary, offered price, deadline, private detailed instructions, and up to three PDF/DOCX/TXT supporting files (3 MB each). All order listings are behind member login. Only the client, selected writer and authorized administrator can see the full instructions and private attachments.
- Writers can browse bidding requests, submit proposals, view private instructions only **after** assignment, and upload completed work. Clients cannot download completed files until the administrator approves the latest submission.
- The member home dashboard displays four clearly separated workspaces; the writing page uses a compact professional task interface instead of repeating the public marketing page.

## Install on existing GitHub repository

1. **Make a reliable backup of the existing SQLite database and private uploads first.** In particular, keep the Railway persistent volume mounted at `/data` if that is where `DATABASE_PATH` points. Never delete or remount the live volume.
2. Extract this ZIP. Upload the changed files to the repository ROOT, replacing matching files, and add the new `admin-account.js` file. Preserve the filenames and your existing `assets/`, `tests/`, `.github/`, and other source files. **Do not upload the ZIP itself.**
3. Commit as `Add sole administrator login and organized writing workspaces`.
4. Railway should deploy automatically. Confirm the latest deployment shows **Active**, then check `/account.html?mode=admin`, `/dashboard.html`, `/writing.html`, and `/writing-admin.html`.
5. **One-time owner setup:** open `https://prowelljobs.com/account.html?mode=admin`. Enter the **existing private Railway `ADMIN_KEY`** into Setup Key, then choose the owner's actual name, owner email and a unique password (12+ characters). The key is not replaced and must never be shared, sent in screenshots, or added to GitHub. The setup should redirect you to `/admin.html`.
6. Sign out. Reopen `https://prowelljobs.com/account.html?mode=admin`. It should show **only Administrator login**, not registration. Sign in with the email/password from step 5. Test job moderation and open `writing-admin.html` to view open orders and pending files.
7. Test: register two separate normal accounts (writing client and writer), verify their emails, submit a harmless proofreading order with a TXT attachment, bid, and select from the admin dashboard. Check the selected writer can access the attachment but other bidders cannot. Submit and approve one harmless TXT deliverable; confirm client downloads only afterward.
8. Check that existing job-posting email alerts still work. This patch does **not** modify `notifications.py` or any Railway Resend DNS/keys.

## Administrative access and recovery

**No admin role is offered in the public signup selector.** The first owner account is created only when someone knows your private Railway `ADMIN_KEY`; the database enforces the singleton record with a fixed primary key. Once it is created, the owner logs in using email and password, and no further admin account registrations are accepted.

Store your new owner password in a password manager. This release does **not** implement online admin password reset: if the owner loses access, a controlled offline, audited database recovery procedure and backup are necessary. **Do not delete the database to reset admin access**—that would risk user, job, writing and private document data.

The admin session uses a secure HttpOnly cookie and expires after 7 days or on logout. Do not share owner credentials. Keep the database on a persistent Railway volume, and use HTTPS as already configured.

## Operational cautions

- This is a tested MVP, not a fully audited production hiring, academic-services or file-hosting platform. Before collecting sensitive files at scale, add malware scanning, independent security testing, account recovery, email deliverability monitoring, backups, dispute handling, retention/deletion policies and local/international privacy-law review.
- Writer **bids are price quotations, not paid transactions**. No escrow, commissions, payments or payouts are implemented. Registration remains **free**.
- Writing requests must be legitimate editing, tutoring, research guidance, translations, professional content or other permitted services. Users must not outsource graded assignments or exams to be submitted as their own.
- The MVP currently quotes writing projects in **KES**. Multi-currency pricing and payment/escrow require a separate future integration.
- Uploaded files are placed outside the public web root on the Railway volume (by default beside the SQLite database). Unselected bidders cannot access attachment endpoints, and customer deliverables remain locked until approval. Administrators should handle unfamiliar files cautiously.

## Source and tests

The patch includes changed website/server files and this guide. A separate full source ZIP includes the existing code and the new regression test.

Local test: `python -m unittest discover -s tests -q`. JavaScript syntax: `node --check admin-account.js`, `node --check writing.js`, `node --check writing-admin.js`.
