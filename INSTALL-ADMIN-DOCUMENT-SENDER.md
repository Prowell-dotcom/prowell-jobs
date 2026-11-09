# Prowell Jobs — Administrator Document Email Sender

This is a small upgrade for your current GitHub + Railway deployment.

## What it adds

- Moderation Center link: **Send document to client**
- Administrator-only page at `https://prowelljobs.com/admin-documents.html`
- Send **one PDF, Word, Excel, PowerPoint, plain text, OpenDocument, JPG or PNG** attachment to one recipient email per submission
- Recipient email, custom subject, optional message, attachment preview and a required final confirmation
- Sender/Resend submission status and a private last-30 message history
- Max attachment: **7 MiB**; limit **12 sending attempts per hour per source IP**
- No attachments stored in a public directory or in the local SQLite history; only metadata stored

Emails use the existing Railway `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` variables. **Do not change or re-enter your secrets.** This upgrade does not touch `notifications.py`.

## GitHub installation

1. Back up your current source and Railway database before updating.
2. Extract the ZIP. Do **not** upload the ZIP itself as one file.
3. Open `https://github.com/Prowell-dotcom/prowell-jobs`, branch `main`.
4. At the repository root, upload/replace these six website files:
   - `server.py` (updated)
   - `admin.html` (updated)
   - `Dockerfile` (updated)
   - `admin_document_sender.py` (**new**)
   - `admin-documents.html` (**new**)
   - `admin-documents.js` (**new**)
5. Optional: upload `tests/test_admin_documents.py` inside the **tests** folder.
6. Commit using `Add administrator document email sender`.
7. Wait for Railway's latest deployment to become **Active**; existing Railway volume and environment variables remain unchanged.
8. Sign in via `https://prowelljobs.com/account.html?mode=admin`, open `https://prowelljobs.com/admin.html`, click **Send document to client**.
9. First test: send a small, non-sensitive PDF to an email you control; confirm Resend's dashboard shows it and the email arrives.

## Important notes

- The page accepts **one recipient and one file at a time**. You can submit another email afterward.
- Resend's API accepting an email does **not guarantee inbox delivery**; confirm receipt or review your Resend dashboard for bounces.
- Keep your administrator account private; the endpoint requires its existing session plus CSRF validation.
- No malware/virus scanning is included. Only send documents you've checked. Avoid confidential identity/medical records through ordinary email. For sensitive writing orders, use the existing approved private portal delivery instead.
- The upload limit is deliberately not unlimited, to protect the server and meet email attachment constraints.
- A 24-hour Resend idempotency key and a local audit ID reduce duplicates when retrying the same request.
- There are no new Railway variables and no changes to the private `/data` volume.

## Local testing

With the source and `tests/` folder present, run:

```bash
python -m unittest discover -s tests -v
```

The complete pre-deployment backend suite passed 35 tests. The live email delivery and final browser UI still need confirmation on the deployed website.
