# Prowell Jobs — Document email default, simple send, and 7-day activity

Replace these six files in the GitHub repository root: `admin-documents.html`, `admin-documents.js`, `admin_document_sender.py`, `admin.html`, `admin.js`, and `server.py`. The optional `tests/test_admin_activity.py` adds 4 regression tests.

- The document-email message is prefilled with **It is a pleasure working with prowelljobs.com** and can be edited.
- The extra browser confirmation dialog before sending is removed. Keep checking the recipient and the required confirmation checkbox before submitting.
- The Moderation Center now has a private **Recent activity (last 7 days)** panel. It shows new job postings, job applications, writing requests, writer assignments, and accepted document emails, with relevant contacts.
- Document sender's **Recently sent** list also shows only the latest seven days.
- Records older than seven days disappear from these two views; **underlying jobs, applications, writing orders, private files, and historical database rows are not deleted**.
- This is a protected admin-only endpoint, and the existing Resend headers, administrator session, CSRF, and multiple-attachment behavior remain unchanged.

After committing changes, confirm Railway is **Active**, hard-refresh `https://prowelljobs.com/admin.html`, and test `https://prowelljobs.com/admin-documents.html`. Test first with a harmless PDF sent to an email you own. A successful response means Resend **accepted** the message, not that it was delivered to an inbox.

Keep the existing Railway volume and `DATABASE_PATH`, `ADMIN_KEY`, `RESEND_API_KEY`, and `NOTIFY_FROM_EMAIL` unchanged. Back up the database before deployment.
