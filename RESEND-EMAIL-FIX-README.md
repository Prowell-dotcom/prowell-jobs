# Prowell Jobs — Resend email request fix

This small patch adjusts the website notification adapter to include the same explicit `Accept: application/json` and `User-Agent: ProwellJobs/1.0` headers used in the manually successful Railway console email test.

## Installation
1. Download and extract this zip.
2. In https://github.com/Prowell-dotcom/prowell-jobs, select `Add file` -> `Upload files`.
3. Upload `notifications.py` **into the repository root**, replacing the previous file. You can also upload `tests/test_notifications.py` into the existing `tests` folder to keep its assertions current.
4. Commit as `Use verified Resend request headers for job alerts`.
5. Confirm Railway `positive-caring / prowell-jobs` deploys and is Active.
6. In https://prowelljobs.com/admin.html, sign in -> Notifications -> Send test email to administrator. Verify the new item says `sent` and the message reaches Gmail.
7. Submit a new clearly marked TEST job and confirm the administrator receives an approval alert without logging in first. Remove/reject the TEST job afterward.

## Do not change
Your `ADMIN_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, domain DNS, Railway volume, and database do not need editing for this patch.

## Important
- This fixes a likely difference between the successful manual test and the site's automatic API requests. It has passed local mocked tests, but actual automatic delivery must still be confirmed after deploy.
- The manual Railway console email proved that Resend accepted and delivered a test with explicit headers. It did not by itself prove that the automatic job-submission path can send email.
- Existing retry items may appear in the notification log; focus on a **new** test record created after deployment.
- Never upload API keys or a database file to GitHub.
