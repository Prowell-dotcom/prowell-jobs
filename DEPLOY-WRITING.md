# Prowell Jobs — Writing & Digital Services Marketplace

**Website:** https://prowelljobs.com  
**Public writing marketplace after deployment:** https://prowelljobs.com/writing.html  
**Administrator writing review:** https://prowelljobs.com/writing-admin.html

## What is new

- Free **Writing Client** and **Writer / Tutor** account types, using your existing member email-verification/login system. Existing Employer accounts can post writing requests; existing Job Seeker accounts can also bid.
- Public list of open writing projects with category, brief, due date and optional KSh budget.
- Customers post permitted writing-support requests; registered writers propose a price, delivery period and brief proposal.
- The customer alone sees proposals for their order and selects one writer. Writer email addresses are not published.
- The selected writer can submit PDF, DOCX or TXT files (max **3 MB**) to private server storage.
- Only an authenticated administrator can access the pending file and **approve** it. Before approval, the customer's download request is rejected. Rejected submissions go back to the writer for revision.
- Transactional emails use your existing Resend outbox and **existing working `notifications.py`** for new orders, bids, writer selection and review decisions.
- A public landing page, personal workspace and separate administrator review page with a matching modern Prowell look.

## Deployment — read before uploading

1. **Make an independent backup of your existing SQLite database and files** before uploading. Do not delete your Railway project, database volume, or existing database records. Your current Railway trial may not have automatic backups.
2. Extract `Prowell-Jobs-Writing-Marketplace-Upgrade.zip` on your computer.
3. Open `https://github.com/Prowell-dotcom/prowell-jobs`, choose **Add file → Upload files**, and drag the extracted website files and the `tests` folder into the repository root (do not upload the ZIP itself).
4. Commit with the message `Add Prowell Writing marketplace with bids and admin-reviewed delivery`.
5. Watch Railway's newest deployment and GitHub Actions. Confirm **Active** and all tests passing.
6. Open `/writing.html`, create one **Writing client** and one **Writer / Tutor** account using **different email addresses** you control; verify both emails.
7. Client posts a clearly marked **test proofreading request**, writer bids, client selects writer, writer uploads a safe test TXT, and administrator reviews via `/writing-admin.html`.
8. Confirm the client cannot download **before** approval and can download **after** approval. Delete test data through an approved process if needed.

**Important:** Do **not** upload `.github` again if the folder is already present. Existing CI settings and secrets remain unchanged. Do **not** replace your working `notifications.py`; this patch intentionally leaves it untouched.

## Railway persistent storage

The existing `DATABASE_PATH` variable remains unchanged. By default, private uploads are written to a `writing-private-files` folder **beside your SQLite database**. If your database is stored on the Railway volume `/data`, uploads will also be stored on that same persistent volume, e.g. `/data/writing-private-files`.

You can optionally set `WRITING_UPLOAD_DIR=/data/writing-private-files`, but only if a volume is mounted at `/data`. **Never** set the upload path inside the public repository or website root. Do not publish file URLs or expose your volume.

The service uses your existing `ADMIN_KEY`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, and `ADMIN_NOTIFICATION_EMAIL` variables. No payment gateway, subscription, or membership fee is included.

## Operational and safety limitations

This is a working **MVP**, not a fully hardened marketplace or legally reviewed education service. Before inviting large numbers of customers/writers, add: malware scanning/sandbox review of uploaded files, content moderation and takedown/reporting, contractual terms, age/identity checks where relevant, retention/deletion policy, backups, dispute handling, audit logging, abuse/spam controls, staff access controls and data-protection review. **Administrator approval is a manual content check, not a guarantee that a file is safe or accurate.** Download untrusted attachments in a controlled environment.

The marketplace is limited to permissible tutoring, editing, citation support, professional writing, copywriting and related assistance. Do not offer writing of exams or graded assignments that students submit as their own. Clients must attest that their request is permitted. This is not an automated plagiarism or academic misconduct detector.

Bids are **quotations only**. There is no integrated payment, escrow, commission, invoicing, dispute refund, or automatic writer payout. Agree on fees and terms independently until a compliant payment system is developed. Account creation remains **free**.

## Files included in this update

- `server.py` — existing server plus new authenticated routes and additive DB tables
- `writing_marketplace.py` — new marketplace API and private upload logic
- `writing.html`, `writing.js`, `writing.css` — client/writer experience
- `writing-admin.html`, `writing-admin.js` — admin approval queue
- `account.html`, `member.js` — new signup roles and dashboard labels
- `index.html`, `jobs.html`, `dashboard.html`, `admin.html`, `sitemap.xml` — navigation and discovery links
- `tests/test_writing.py` — end-to-end privacy and workflow tests

Tests: `python -m unittest discover -s tests -v`.

**Support:** prowellofficial@gmail.com
