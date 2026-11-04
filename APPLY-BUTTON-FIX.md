# Prowell Jobs: working Apply for this role button

## Why it previously seemed to do nothing
The old button tried to open a job poster’s external website using a browser pop-up, or a mailto: / tel: handler. On many phones and browsers, these actions can fail silently. There was no internal applicant inbox.

## What is now implemented

- Every **real approved job** has an Apply for this role button that opens a Prowell Jobs application form on the same page. Fictional sample jobs remain non-applicable.
- Applicant enters full name, at least one contact method, experience, country / city (optional), and a skills / suitability message. Consent is required. No documents or IDs are collected.
- Applications are inserted privately into the **existing SQLite database**, in a new additive `applications` table. No previous jobs, profiles or reviews are deleted.
- The admin page `/admin.html`, after the normal `ADMIN_KEY` unlock, has a new **Applications** tab. The admin can mark items pending, reviewed, or closed. They must get separate permission from applicants before sharing private details.
- Applicants see a confirmation and **one-time private withdrawal code**. They can withdraw/delete their own submission from the application form.
- Employer website/email/phone links, if provided, now appear as normal visible links under the job details (not a silent pop-up).
- No email is automatically sent to `prowellofficial@gmail.com` or to any employer. Administrators must regularly check the Applications tab.

## Publish to your existing GitHub and Railway

1. Review and protect existing data first. Your Railway backup feature may require a paid plan; do not delete or replace your mounted volume. If you have important records, arrange a database export or backup before modifying production.
2. Download `Prowell-Jobs-Application-Fix.zip`, extract it, and open your existing repository: https://github.com/Prowell-dotcom/prowell-jobs
3. Choose **Add file → Upload files**, and select the **files inside** the extracted folder (not the ZIP itself). Commit to `main`. This overwrites the six matching code files and updates README, while leaving other files and folders alone.
4. Railway should redeploy automatically. Open **positive-caring → prowell-jobs → Deployments** and confirm the newest deployment is Active. No new Railway variables are required; keep your existing `ADMIN_KEY`, `DATABASE_PATH`, domain and volume unchanged.
5. Test with an approved **clearly marked test vacancy**: tap Apply for this role → fill the form → submit → save the private reference and withdrawal code. In `/admin.html`, enter your existing ADMIN_KEY → Applications. Verify the test submission appears privately. Then withdraw the test submission with its code.
6. If you want the additional automated integration test in GitHub Actions, open the repository’s `tests` folder and upload `test_applications.py` from the separate full project archive. This is optional for deployment.

## Important limitations

- **This is a starter recruitment workflow**, not a full applicant tracking system. No identity verification, CV upload, employer logins, notifications or external delivery is available yet.
- Public applicant details are never exposed through a public API. The site is protected with HTTPS and the existing shared admin key, but production privacy and security need further work (role-based admin accounts, stronger anti-spam, encrypted backups, retention policies, incident response, and legal review).
- Never send private applicant information to an employer without verifying the employer and getting the applicant's express permission.
- If a browser shows an older cached version, refresh and try again after Railway finishes deploying.
