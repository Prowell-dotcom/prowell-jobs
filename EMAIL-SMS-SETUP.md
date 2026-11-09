# Prowell Jobs: email and SMS notifications

This release adds **opt-in employer notices** and **administrator new-vacancy alerts**. The existing Railway volume, domain and ADMIN_KEY stay unchanged. No external messages will be sent until you configure a provider. The public application form and private applications inbox continue working as before.

## What gets sent

- **Admin**: when any new vacancy is submitted, an email goes to `ADMIN_NOTIFICATION_EMAIL` (defaults to prowellofficial@gmail.com) when Resend is configured. An optional SMS goes to `ADMIN_NOTIFICATION_PHONE` when Twilio is configured.
- **Employer**: if they check the opt-in box and provide a notification email or E.164 SMS number, they receive a submission acknowledgment and an approved/rejected update, provided that channel is configured.
- **No candidate details or applicant contact information** are included in any notification. Job seeker applications are *not* automatically forwarded to employers.
- Messages are queued in SQLite (`notification_outbox`) and retried on temporary failures. The Admin → Notifications tab shows delivery status. An entry marked *sent* means accepted by the provider, not necessarily delivered to the recipient inbox/phone.

## Recommended first: enable email with Resend

1. Create your own Resend account at https://resend.com/ . Add a sending domain (for example `prowelljobs.com`) and copy the exact DNS records Resend provides into the domain manager. This verifies sending authorization; do not delete or overwrite existing Railway web-hosting DNS records.
2. Create a restricted sending-only API key. Keep it in Railway service Variables, never GitHub or a screenshot.
3. In **Railway → positive-caring → prowell-jobs → Variables**, set:

| Name | Example value |
| --- | --- |
| `RESEND_API_KEY` | Your own secret Resend API key |
| `NOTIFY_FROM_EMAIL` | `notifications@prowelljobs.com` (must be allowed for your verified sending domain) |
| `ADMIN_NOTIFICATION_EMAIL` | `prowellofficial@gmail.com` |

4. Deploy staged variables. Submit a clearly labeled test vacancy with an opted-in email and verify messages and Admin → Notifications records.

## Optional: enable SMS with Twilio

1. Set up your own Twilio account at https://www.twilio.com/ and enable sending to intended countries. SMS is not free and rules/sender requirements vary by destination; verify country-specific permissions and prices.
2. In Railway service Variables, set:

| Name | Example value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Your own Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your own secret Twilio auth token |
| `TWILIO_MESSAGING_SERVICE_SID` | Your sender-enabled messaging service SID |
| `TWILIO_FROM_NUMBER` | Alternatively, your SMS-capable Twilio sender number, in +international format |
| `ADMIN_NOTIFICATION_PHONE` | Optional Prowell admin recipient number, e.g. +254... |

Only ONE of `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` is necessary. For many countries Twilio requires additional sender registration. Not all country routes are supported.

## Deployment

1. Keep the existing `DATABASE_PATH=/data/prowell-jobs.sqlite3`, persistent volume mounted at `/data`, `ADMIN_KEY`, and website domain untouched.
2. Copy the changed `server.py`, `notifications.py`, `Dockerfile`, `index.html`, `app.js`, `admin.html`, `admin.js`, and the new `EMAIL-SMS-SETUP.md` into your existing repository root.
3. Commit the changes and verify Railway deploys the updated app. Do not add API keys to GitHub.
4. For a production recruitment platform, strengthen authentication, abuse protection, email verification, audit logs and backups before broad promotion. Submitted email/phone contact details are user-supplied and not identity-verified.

The notification integration uses Resend's `POST https://api.resend.com/emails` and Twilio's Messages REST endpoint, with Python standard-library HTTPS and no pip dependencies. No notification can be promised until provider credentials, DNS verification, and real delivery tests succeed.
