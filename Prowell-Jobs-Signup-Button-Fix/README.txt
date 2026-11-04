PROWELL JOBS — CREATE ACCOUNT BUTTON FIX

Cause: The previous member.js referenced #form-signup, #form-login and
#form-forgot, but the real account.html uses #signupForm, #loginForm and
#forgotForm. As a result, clicking Create account never made the form visible.

This package contains a corrected member.js. It preserves the existing API,
backend, job database, administrative system and notification system.

INSTALL:
1. Open https://github.com/Prowell-dotcom/prowell-jobs
2. In the repository main (root) folder, open member.js and click Edit (pencil).
3. Replace its contents with the attached member.js, or use Add file > Upload
   files to replace the existing member.js in the repository root.
4. Commit using: Fix Create Account and login tab switching
5. Wait for Railway's latest deployment to show Active.
6. On https://prowelljobs.com/account.html?mode=signup, hard refresh with
   Ctrl+Shift+R, or open a private browser tab.
7. Test Create account, Log in, Forgot your password and sign-up with
   an email address you control. The new account should receive email
   verification if Resend is correctly configured.

DO NOT change admin keys, Resend settings, DATABASE_PATH, or your Railway volume.

TESTING:
JavaScript syntax checked with node --check; simulated DOM tests confirm
both initial URL modes and clicking the signup/login/forgot tabs.
The live website must still be verified after deploying the fix.
