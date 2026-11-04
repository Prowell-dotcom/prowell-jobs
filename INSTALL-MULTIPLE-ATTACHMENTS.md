# Prowell Jobs — Multiple Attachments Upgrade

This update makes **both** admin-to-client email attachments and writing-order supporting files additive. Choosing files in another round adds them to the visible queue rather than replacing previously chosen documents. Each file in the queue has an individual **Remove** button.

## Files to update

Replace these six files in your GitHub repository root:

- `admin_document_sender.py` — accepts multiple attachments and emails all of them in one Resend message. Still accepts legacy single-document requests.
- `admin-documents.html` — multi-select input, five-file guidance and file-list styling.
- `admin-documents.js` — maintains selected files across multiple selections and lets administrators remove them before sending.
- `writing.html` — names the instruction upload input, adds visible attachment list and cache busting.
- `writing.js` — maintains multi-round instruction upload queue and removes files individually.
- `writing.css` — file-list styles.

The ZIP does not contain database files, credentials, `.github` folder or a replacement server. **Do not change Railway's DATABASE_PATH, ADMIN_KEY, Resend keys, or mounted /data volume.**

## Attachment limits

- **Admin document sender:** up to **5 files**, each at most **7 MB**, **15 MB combined**.
- **Writing supporting documents:** up to **5 files**, each at most **20 MB**, **60 MB combined**.
- File types are restricted to supported documents/media. Arbitrary executables, unlimited uploads and unbounded email attachments are not safe to permit.
- **Writing completed deliverables:** the current selected-writer submission remains a single file; this update specifically addresses instructions/supporting files and administrator emails.

## Verification

1. In the Moderation Center open **Send document to client** and select one document. Choose a second document with the same button. Both should appear in a list. Remove one, re-add one, and send to a test address. Confirm the email has the right attachments.
2. In Writing Projects, use a writing-client account to start a request. Select an instruction document, then a second one. The queue should list both; after posting, select a writer and confirm they can download both private documents, while unselected bidders cannot.
3. Confirm Railway is Active and test administrator sign-in, existing job listings, and Resend email delivery.

48 local Python backend tests passed using a working-copy project, plus JavaScript syntax checks. Live deployment / inbox delivery have not been verified.
