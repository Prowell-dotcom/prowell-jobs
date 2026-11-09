# Prowell Jobs — free accounts upgrade

**All membership is free.** There is no KSh 100 charge, M-Pesa push, payment flow, paid tier or billing integration in this release. 

## What it includes

- New responsive public homepage with inclusive sector cards, compelling benefits, leadership message and free sign-up calls to action.
- A **draft** welcome message credited to CEO Mr. Ngugi **for his approval before publication**. Obtain approval for the wording; do not present this draft as a verified direct quote.
- Separate job-seeker and employer account registration; secure passwords with salted PBKDF2-SHA256 hashes.
- Secure HttpOnly cookie sessions, 7-day expiry, CSRF tokens, login and logout.
- Email confirmation, forgotten-password email and secure password reset (uses your existing verified Resend settings).
- Role checks for vacancy posting (employers) and job applications/candidate profiles (job seekers).
- Personal dashboard showing **only the signed-in user's** submitted vacancies, applications and candidate profiles, linked to their member ID.
- Existing admin moderation, Resend notification delivery adapter and live SQLite database structure kept in place.
- Public browsing of available jobs remains accessible without an account.

## Safe upgrade on GitHub and Railway

1. **Protect your current data first.** Your existing Railway persistent volume contains real job and application information. Create a verified SQLite backup/export before changing the live code if your existing data matters. Do not remove or recreate the Railway volume.
2. Download and extract `Prowell-Jobs-Free-Accounts-GitHub.zip`. Do **not** upload the ZIP directly to GitHub.
3. Replace matching root files and add new root files in `Prowell-dotcom/prowell-jobs` (branch `main`). Upload all **contents** of the extracted project, retaining the `assets/`, `.github/workflows/`, and `tests/` paths.
4. Make sure `accounts.py`, `member.js`, `membership.css`, `account.html`, `dashboard.html`, `jobs.html` and the updated `Dockerfile` appear at repository root. **Do not omit `notifications.py`**, which preserves the working Resend request headers.
5. Commit with message `Launch free Prowell Jobs accounts and new homepage`.
6. Open Railway `positive-caring → prowell-jobs → Deployments`; verify the latest deployment is Active. Do **not** change the existing `DATABASE_PATH`, `/data` volume, `ADMIN_KEY`, Resend variables or domain. Railway's existing `PORT` setting still applies.
7. Visit `https://prowelljobs.com/` to see the new homepage, and `https://prowelljobs.com/account.html` to create separate test accounts using email addresses that you control.
8. Test account email verification, login, logout, employer vacancy posting (pending moderation), job seeker application (private), user dashboard visibility, admin approval, and notifications. The admin dashboard is still `/admin.html`.

**Email verification:** The signup process sends a verification message from your configured Resend service. `MEMBER_EMAIL_VERIFICATION_REQUIRED` defaults to `1` and should remain enabled in production. If Resend is unavailable, newly registered users can sign in but cannot post/apply until their address is verified.

**Account ownership:** Only submissions made **after this upgrade** are linked to accounts. Existing vacancies/applications are retained in the database but are not retroactively associated with new accounts; admins can continue reviewing them as before.

**Fees:** No payment variables or M-Pesa API keys are necessary. The Till number and phone number you provided are **not used for membership**.

## Tests and limitations

Run locally: `python -m unittest discover -s tests -v` (28 tests passed on the prepared release).

For production scale, add bot prevention/CAPTCHA, stronger account recovery controls, administrator MFA, database backups/restore verification, an appropriate retention/deletion workflow and legal review of terms and privacy. This version has no resume upload, employer self-service applicant inbox, automated matchmaking or paid membership. No real email is sent during automated tests. Test actual email delivery on the live Railway deployment before promoting signups widely.

## Order watcher: optional automatic acceptance

The private Chrome extensions at `extension/4writers/` and `extension/good-writers/` have a separate **Enable automatic order acceptance** checkbox in the extension popup. It is off by default. Turn it on before START WATCHING only if the relevant platform permits automated acceptance and you accept the responsibilities that come with taking an order. The opt-in is consumed on the first detected available order and cleared when you press STOP. Processing orders remain View-only.

Both continue refreshing supported order listings at a one-second interval while armed. On an eligible order: sound notification, stop refresh, click View. With automatic acceptance enabled, the extension uses small 140-pixel scroll steps to find Take it, clicks it, waits at least half a second and waits for the on-page OK button. After OK, it looks for I understand: 4Writers can scroll to the acknowledgment; Good-Writers expects it to be visible without additional scrolling. The extension stops when the order ID is not verified, controls are missing/ambiguous, a security challenge appears, or the workflow expires. It **never** tries to evade bot detection. Browser-native confirmation dialogs are not automatically controlled by this workflow.

**Install:** Obtain the latest private extension ZIP from the owner/admin dashboard following the Railway deployment, or use the corresponding `extension/` folder in GitHub via Chrome's Load unpacked feature. Reload the extension in `chrome://extensions`. A source-code update does not automatically update already installed unpacked extensions. After one simulated acceptance, verify the actual result in the platform itself; a click sequence is not proof of assignment. Do not enable the feature until you have checked the websites' automation rules.
