# Prowell Jobs — Place Bid + Direct Writer Assignment + Larger Uploads

## Install on GitHub and Railway

This is a small, tested update for the existing Python/SQLite application. It does not replace `server.py`, `Dockerfile`, `notifications.py`, your database, or any Railway environment variable.

1. Back up your live SQLite database and private writing attachments before deploying changes.
2. Extract the ZIP and upload **these seven files** to the **root** of `Prowell-dotcom/prowell-jobs`, replacing the existing ones:
   - `writing_marketplace.py`
   - `writing.js`
   - `writing-admin.js`
   - `writing.html`
   - `writing-admin.html`
   - `writing.css`
   - `admin.html`
3. Commit as `Fix writing bids, direct administrator assignment and larger uploads`.
4. In Railway, confirm the latest build is **Active**. Do not delete your persistent `/data` volume or change `ADMIN_KEY` or Resend.
5. Refresh with Ctrl+Shift+R to clear cached JavaScript.

## How to use

### Writers / bidding
Sign into a **verified** member account, open `https://prowelljobs.com/writing.html`, and click **Place Bid** under any open order you did not create. Enter your bid amount, completion days and proposal, then click **Submit Bid**. A client viewing their *own* request will see a link to review bids, not a bid button. Already-submitted bids display a confirmation instead of a duplicate bid form.

### Direct admin assignment (NO prior bid required)
1. Log into your existing owner administrator account at `https://prowelljobs.com/account.html?mode=admin`.
2. Open `https://prowelljobs.com/admin.html` and click **Assign a Writer** (or navigate to `https://prowelljobs.com/writing-admin.html`).
3. Under an **Open for Bids** order, select a **verified registered Writer or Job Seeker** in the dropdown and click **Assign Writer Directly**. An admin may alternatively review bids and assign a specific bidder.
4. Confirm your selection. Only that selected account now gains access to private project instructions and supporting files, and bidding closes. The action is stored in the assignment audit table and email notifications are queued through the current Resend adapter.
5. The selected writer uploads their work from **My projects & delivery**; the customer sees it only after you approve it in **Writing Administration**.

An administrator cannot reassign a job already assigned to someone else using this simple flow. It protects against double assignment. A later reassignment and dispute process would need its own audited workflow.

### Upload limits and formats
Uploads are NOT unlimited: unrestricted files would be unsafe for your users and hosting. The release supports **up to 20 MB per file**, **up to 5 private supporting files per request**, and **60 MB in total** for a request. Submitted final documents may be **up to 20 MB**. Supported formats: PDF, DOCX, XLSX, PPTX, ODT, RTF, TXT, MD, CSV, PNG, JPG/JPEG, WEBP, MP3, WAV, MP4. Executables, scripts, compressed archives and unsupported files are blocked. Large uploads are still subject to Railway/proxy and storage limits.

## Privacy, safety and existing features
- All new admin APIs require authenticated administrator sessions; changing `ADMIN_KEY` is not necessary.
- The private writer directory is never exposed to ordinary members.
- Instructions and attached files stay private to the client, selected writer and administrator. Non-selected users cannot download them.
- Submitted work remains unavailable to clients until administrator approval.
- The old jobs board, user registrations, administrator login and `notifications.py` remain unchanged.
- Malware scanning, abuse detection and retention/deletion safeguards are still needed before accepting untrusted or sensitive files at scale. Avoid posting graded assignments for ghostwriting.

## Tests performed
`python -m unittest discover -s tests -q` — 33 tests passed, including direct assignment without a prior bid, role/CSRF restrictions, attachment privacy, file approval gating and a 4 MB upload validation.
`node --check writing.js` and `node --check writing-admin.js` — syntax checks passed.

These are local automated checks; the live Railway deployment and browser UI still need verification after upload.
