# Prowell Jobs — Account Security & Core Functionality Upgrade

**Target:** `https://github.com/Prowell-dotcom/prowell-jobs` → Railway `positive-caring` / `prowell-jobs`.
**Domain:** `https://prowelljobs.com` (no `www`).

This is an **incremental upgrade** to the current live account/marketplace code, not a replacement website. It does not create an administrator account, change stored passwords, delete records, or change Railway environment variables. All database changes are additive and happen when the server starts.

## Before changing anything

1. In Railway, ensure you have a working deployment and the persistent volume `/data` is still mounted, with `DATABASE_PATH=/data/prowell-jobs.sqlite3`.
2. Make a **verified backup** of the SQLite database **and** the directory containing private writing uploads. (Default: `/data/writing-private-files` when the database is on `/data`.) Do not publish these files or include them in GitHub.
3. Preserve `ADMIN_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, and `ADMIN_NOTIFICATION_EMAIL`. The working Resend user-agent and headers in `notifications.py` must remain unchanged.
4. Check that your GitHub `Dockerfile` includes `server.py`, `writing_marketplace.py`, `member.js`, `admin-account.js`, `writing.js`, `writing-admin.js`, `writing.html`, `writing-admin.html`, `membership.css`, and `writing.css`. The current Dockerfile already does; **do not upload an outdated Dockerfile**.

## Upload to GitHub

Unzip `Prowell-Jobs-Account-Security-Core-Upgrade.zip`, choose **Add file → Upload files** in the main repository, and upload the following **matching paths**, replacing existing files:

```
server.py
writing_marketplace.py
account.html
admin-account.js
member.js
dashboard.html
membership.css
writing.html
writing.js
writing.css
writing-admin.html
writing-admin.js
```

Optional regression tests in `tests/` (preserve the folder):

```
tests/test_account_security_upgrade.py
tests/test_writing_project_messages.py
```

Commit as `Add secure account recovery and member workspace controls`.
Railway should automatically rebuild; verify the newest deployment is **Active**, the health endpoint responds, and the site loads.

## What is new

- **Administrator:** The existing owner can choose **Forgot administrator password?**, enter the *registered owner email*, and request a 30-minute single-use reset link. All old admin sessions are revoked after a successful password reset. One-time owner registration stays CLOSED.
- **Members:** Existing ordinary member forgot-password feature remains, with a confirm-password field. Dashboard adds Resend Verification Email, profile-name/phone editing, and password change (which revokes all member sessions).
- **Employers:** Dashboard adds an inbox for **reviewed/closed applications submitted to vacancies owned by that employer**. Pending applications and other employers' private records are excluded. Existing job posts not originally associated with a member account cannot automatically be reassigned.
- **Writing clients:** Can cancel an order only while it is **open for bids** and no writer has been assigned. Cancellation closes bidding and alerts existing bidders.
- **Selected writer and client:** Can exchange private project messages after assignment. Other bidders cannot view or write messages. The administrator can read the thread for oversight; messages are text-only, up to 2,500 characters.

## Post-deployment acceptance checklist

- Ordinary sign up, login, logout, email verification and forgotten-password link still work.
- Dashboard → `Resend verification email` (unverified account only); verify the new email arrives and the link works once.
- Dashboard → `Account & Security`: edit profile, then change password and confirm prior sessions sign out.
- Account page → `Administrator` → `Forgot administrator password?`; request email, reset using the received link, and log in with the new password. **Only attempt this if you can receive messages at the registered owner email.**
- Post a job as an employer; apply as a job seeker; have admin mark the application **reviewed**; only that employer should see it in the employer inbox.
- Post an allowed writing project; cancel while open (a selected project cannot be cancelled in this way).
- Assign a writer; exchange private messages from client and writer dashboards; an unrelated member must receive 403. Admin → Writing Review shows the conversation.
- Submit a deliverable: client download remains blocked until admin approval.
- Admin Document Sender and Resend notification emails still work.

## Operational and privacy notes

- This package deliberately does NOT add job-alert dispatch, CV attachment storage, two-factor authentication, self-service deletion, money collection, escrow, or guaranteed email delivery; these require additional product design, consent, and operational testing.
- Private applicant records become available to their verified employer **only after an administrator marks an application reviewed or closed**. Confirm that your privacy notice and user-facing application disclosures reflect this before live rollout.
- Backups and virus scanning remain important; the existing upload limits do not substitute for file scanning.
- No secret values or production databases belong in this ZIP.
- Offline tests passed but the live Railway instance and real Resend delivery still need confirmation.

## Rollback

If the deployment fails, use Railway's previous working deployment or revert this GitHub commit. Additive database columns/tables will remain but should not disrupt older code. **Never delete the persistent Railway volume** to roll back.
