# Prowell Jobs — Administrator access repair

## Cause

The Python server static allowlist omitted `/admin-account.js`. Even when the browser loaded `account.html`, its Administrator button handler returned HTTP 404, making the Administrator tab appear unresponsive. The latest owner upgrade also intentionally disabled the previous ADMIN_KEY-only moderation sign-in.

## Install

1. In `Prowell-dotcom/prowell-jobs`, upload `server.py`, `admin-account.js`, and `account.html` from this ZIP **to the repository root**, replacing the two existing files. Do not upload the ZIP itself.
2. Commit `Restore administrator tab and one-time owner login`.
3. Wait until Railway's newest deployment is **Active**. Keep Railway ADMIN_KEY, DATABASE_PATH, existing volume and Resend variables unchanged.
4. Load `https://prowelljobs.com/account.html?mode=admin` and force refresh (Ctrl+Shift+R). The button should now display the initial owner setup or owner sign-in.
5. If the site has not yet created its sole owner account, use Railway's ADMIN_KEY **once** to create an owner email/password. The setup form closes after successful registration.
6. If the owner account **already exists**, sign in with the email/password created during setup. ADMIN_KEY alone no longer signs into the Moderation Center.
7. Test `https://prowelljobs.com/admin.html` and `https://prowelljobs.com/writing-admin.html`.

## If a password was forgotten

Do **not** remove `admin_owner` or delete the database to regain access. This release has no web-based owner password reset. Contact the developer for a controlled, verified recovery procedure that preserves the existing jobs and user records.

## Verification

`https://prowelljobs.com/admin-account.js?v=owner2` must return JavaScript, not a JSON `File not found` response. The one-time setup status API is `/api/admin/bootstrap/status`.
