# Prowell Jobs — instant administrator email alerts for new vacancies

This patch adds an immediate, **bounded** Resend email send attempt when a new job vacancy is submitted for approval. The job is saved first and stays `pending` until you manually approve it. A failed email is recorded and retried automatically; no email service can guarantee exact inbox arrival time.

## What you receive

- **To:** the Railway `ADMIN_NOTIFICATION_EMAIL` (intended: `prowellofficial@gmail.com`).
- **From:** `Prowell Jobs <notifications@prowelljobs.com>` if `NOTIFY_FROM_EMAIL` is set correctly.
- **Subject:** `Action required: new Prowell Jobs vacancy - [job title] ([reference])`.
- **Message:** job title, employer, reference, pending status, and secure link to `https://prowelljobs.com/admin.html`.
- **When:** after the visitor clicks Submit and the vacancy is successfully saved in SQLite; **no administrator login or employer opt-in is required** to trigger the admin alert.

## What's fixed

1. Each new job always queues a private administrator email, even if Resend is temporarily misconfigured.
2. The website immediately attempts to send the admin email after saving the vacancy (up to 6 seconds waiting on the email provider). The applicant can still submit if sending fails.
3. A durable SQLite outbox handles background retries and recovers work interrupted by a restart. Idempotency keys reduce duplicate emails.
4. **Admin → Notifications** now shows a useful sanitized provider error, such as `EMAIL HTTP 403 validation_error`, instead of only `HTTPError`.
5. The administrator **Send test email** button also attempts delivery immediately and reports whether Resend accepted the request.
6. Previous secure admin sessions, notification badges, candidate privacy, and employer email/SMS notice features remain intact.

## Install on GitHub

1. On your computer, extract `Prowell-Jobs-Instant-Approval-Email-Fix.zip`.
2. In `https://github.com/Prowell-dotcom/prowell-jobs`, select **Add file → Upload files** and replace **`server.py` and `notifications.py` at the repository root**. Do not upload the ZIP itself.
3. Open your existing **`tests`** folder and upload the supplied `test_notifications.py` and `test_admin_sessions.py` there, replacing their previous versions. Keeping the regression tests up to date prevents stale test expectations from failing GitHub Actions.
4. Commit as `Send immediate admin email for new job postings`.
5. Railway `positive-caring → prowell-jobs → Deployments` should show a new **Active** deployment. Do not remove/change your domain, the `/data` volume, `ADMIN_KEY`, or `DATABASE_PATH`.

## Required Railway variables (already set up by the owner)

- `RESEND_API_KEY` = valid **sending** API key from Resend (keep hidden)
- `NOTIFY_FROM_EMAIL` = `notifications@prowelljobs.com` (no quotation marks)
- `ADMIN_NOTIFICATION_EMAIL` = `prowellofficial@gmail.com` (no quotation marks)

Your `prowelljobs.com` Resend sending domain must remain Verified. Do not expose API keys in screenshots or GitHub commits.

## End-to-end verification

1. Open `https://prowelljobs.com/admin.html`, sign in, open **Notifications**, and click **Send test email**. The button should report whether Resend accepted it. Inspect the newly created notification in the list.
2. If the test says **sent**, check `https://resend.com/emails` and Gmail Inbox/Spam. `sent` means the API accepted the request; it does not itself prove inbox delivery.
3. Submit a *new*, clearly labeled `TEST - Admin vacancy alert` job using the live **Post a job** form. The administrator should receive an `Action required:` email promptly.
4. Check **Vacancies → Pending** for the test record. Verify it is not published until you approve it.
5. If no email arrives, check **Admin → Notifications → All**, open the relevant record, and look at `Last error type`. Provider HTTP status such as 401/403/422/429 will help isolate API key, sender/domain, invalid request, or rate-limit issues. Also inspect Resend logs and Railway deploy logs for `[Prowell notifications]`.
6. Remove or reject the test job after verification.

**Limits:** No live Resend email has been sent or received as part of this offline patch. Provider latency, quotas, destination spam filtering, and service outages can affect delivery times. This patch does not create SMS alerts without separate Twilio configuration and billing.
