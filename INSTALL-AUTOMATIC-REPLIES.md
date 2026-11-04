# Prowell Jobs — Automatic replies for employers and job seekers

## What this update does

- **New vacancy:** The administrator gets an approval-required email; an employer who explicitly opts in and provides a notification email gets a separate **Pending administrator approval** acknowledgment. The employer gets an approval/rejection email later.
- **Job application:** The administrator gets a private new-application alert. Applicants who provide an email receive an automatic receipt and a message when the admin marks it reviewed or closed. Applications are not automatically forwarded to employers or treated as hiring decisions. Phone-only applicants receive an on-screen reference, but no email.
- **Candidate/skills profile:** The administrator receives a new-profile alert; the job seeker receives an email receipt and an approved/rejected moderation notice.
- **Review or comment:** The administrator receives a moderation alert. The reviewer may supply an optional **private** email and opt in to a receipt and decision notice. Email addresses are **not included in public reviews**.
- **Safety report:** The administrator is alerted, and the reporter receives an acknowledgment if they supplied a follow-up email. Details of reports are not included in notification emails.
- **Job-alert interest:** The administrator is alerted and the subscriber receives an acknowledgment. **This does not activate recurring job alert emails**—those remain a separate future feature.

All automated messages are queued in the existing SQLite notification outbox and processed when the website's notification worker wakes, normally within seconds. Temporary send errors are logged privately and retried. A provider accepting a message is not a promise of immediate inbox delivery. This code does not send replies to messages written directly to a Gmail inbox and does not send SMS to jobseekers; that would require a separate integrated workflow and consent.

## Safe installation in your existing GitHub repository

1. If real submissions exist, back up the Railway SQLite volume before making changes. Do not delete or replace the volume.
2. Download this ZIP and extract it **on your computer**. Do not upload the ZIP itself to GitHub.
3. Upload **`server.py`, `app.js`, and `index.html`** to the root of your existing `Prowell-dotcom/prowell-jobs` repository, replacing the previous versions.
4. Upload the provided `tests/*.py` files into the existing **`tests` folder**, preserving that path. This keeps GitHub Actions checks consistent with the updated backend. Other folders (`assets`, `.github`, etc.) must stay in place.
5. Commit with the message `Add automatic receipts for employers and job seekers`.
6. Railway should redeploy. Wait for **Active** and test `https://prowelljobs.com` and `https://prowelljobs.com/admin.html`.
7. Create a clearly labeled test application for an approved test job using an email you control. Confirm two records in Admin → Notifications: one to the administrator and one receipt to the applicant. Check Gmail and Resend → Emails. Also test a candidate profile and an employer submission.

### Preserve the working Resend fix

**Do not replace `notifications.py`** for this update. Keep your existing, working version containing the two HTTP request headers:

- `Accept: application/json`
- `User-Agent: ProwellJobs/1.0`

You do **not** need a new Resend key, new DNS records, or a different domain. Keep existing `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, `ADMIN_KEY`, and `DATABASE_PATH` environment variables.

## Privacy and operation notes

- Emails go only to addresses submitted via the website's forms. New safety reports do not automatically go to unrelated employers.
- Do not put private applications, report details, withdrawal codes, or contact details in admin email bodies. The administrator should open the secure dashboard to view them.
- A phone number without an email address cannot receive an email. SMS would require Twilio configuration and express SMS consent. No job-seeker SMS is enabled by this update.
- Existing data is retained by additive database changes. New fields are added to `reviews` so reviewers can opt in to private receipts.
- For a production employment platform, add CAPTCHA or equivalent spam defense, backups, privacy/data-retention policies, and appropriate anti-abuse protections before large-scale use.

## Tests

`python -m unittest discover -s tests -v`

24 local integration/unit tests passed, using local test data and mocked email delivery. No real customer emails were sent by these tests. Live sending should be verified after Railway deployment.
