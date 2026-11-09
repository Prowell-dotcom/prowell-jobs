# Prowell Jobs — New/Unseen Badges on Admin Tabs

This patch adds an **unseen-item counter** to each administrator tab:
Vacancies, Applications, Candidates, Reviews & comments, Safety reports, Alert interest, Notifications.

- A badge appears only if that category has **new** submissions since the administrator last viewed it.
- Clicking the category loads its latest records and **clears its badge automatically**.
- Existing records remain in the category, including pending items; only the "new" badge disappears.
- The **section heading's total count** continues to show how many records it contains.
- The read marker is saved in your existing Railway SQLite volume and survives refresh, logout, and login.
- A fresh counter check occurs every 45 seconds while the administrator is logged in.
- All seven counts are accessible **only to an authenticated administrator**; changing read state also requires a valid session CSRF token.

## Deploy these changes to GitHub

1. Keep the existing Railway **prowell-jobs** volume and `DATABASE_PATH`, `ADMIN_KEY`, email variables and domain. Do not delete or recreate them.
2. Open https://github.com/Prowell-dotcom/prowell-jobs.
3. Click **Add file → Upload files**. Upload these three extracted files to the repository ROOT: `server.py`, `admin.js`, `admin.html` (replace matching existing files).
4. Commit with `Add unread notification badges to admin sections`.
5. Railway should automatically deploy. Check that the new deployment is **Active**.
6. Open https://prowelljobs.com/admin.html and sign in. New record counts show on tabs; click a tab to clear that number.
7. Submit a *clearly marked test* safety report or vacancy in a separate browser/device; wait up to 45 seconds for the badge to update. Refresh if necessary. Click the tab to clear it, then refresh to confirm it stays cleared.

**Optional:** The full source package includes `tests/test_badges.py`. Add it to the GitHub `tests` folder for automated regression coverage. Local test run: `python -m unittest discover -s tests -v`. Fifteen integration tests passed locally.

**Note:** A badge reports *new/unseen* records, not pending items needing action. Clicking it does **not** approve or reject submissions. Admin review is still required.

## Security and data

No keys are included. Existing data is retained through an additive migration that creates a small `admin_tab_views` table on startup. This version has a single shared administrator login, so the tab-viewed state is shared for all admins who use this same access key. For independent read badges per administrator, add multi-user admin accounts in a later upgrade.

This patch does not itself resolve an unrelated Resend email-delivery problem. Use the Notifications diagnostics and test-email feature to troubleshoot email separately.
