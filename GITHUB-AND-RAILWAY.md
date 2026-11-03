# Upgrade your existing live Prowell Jobs website — safe deployment

**For:** GitHub repository `https://github.com/Prowell-dotcom/prowell-jobs`, Railway project `positive-caring`, service `prowell-jobs`, public domain `https://prowelljobs.com`.

## Step 0 — Back up what you already have

1. Open **Railway → positive-caring → prowell-jobs → Backups**. If Railway's backup functionality is offered for your existing volume/plan, take a snapshot before the update. Otherwise back up the current SQLite file from the volume using your approved Railway backup method.
2. Confirm the service is currently Online and that `DATABASE_PATH=/data/prowell-jobs.sqlite3` and `ADMIN_KEY` are set in **Railway Variables**.
3. Confirm your volume is mounted at `/data`. Do not replace, delete or reformat this volume.
4. Keep a copy of your current GitHub code or note its last commit SHA so you can roll back a code change if necessary.

## Step 1 — Update the existing GitHub repository

1. Download and unzip `Prowell-Jobs-Global-Upgrade.zip`.
2. Open `https://github.com/Prowell-dotcom/prowell-jobs` and make sure you are on the `main` branch.
3. Choose **Add file → Upload files**.
4. Drag **everything inside** the extracted `Prowell-Jobs-Upgrade` folder, not the ZIP itself. Keep subdirectories such as `assets/`, `tests/` and `.github/workflows/` intact.
5. Review the changes before committing. Your source files `index.html`, `styles.css`, `app.js`, `admin.html`, `admin.js`, `server.py`, `Dockerfile` will be updated, while other new files are added.
6. Commit with `Expand Prowell Jobs worldwide opportunities and candidate profiles`.

**Alternative:** If you are comfortable with Git and have a local clone, copy files into the working tree, then `git add . && git commit -m 'Expand global job categories' && git push origin main`.

**Never** upload your real SQLite database, private `ADMIN_KEY`, passwords, API credentials, or `.env` files.

## Step 2 — Let Railway deploy the update

1. Open Railway's existing **positive-caring → prowell-jobs → Deployments**.
2. Watch the newly triggered deployment from GitHub. Your existing `Dockerfile` runs `python server.py`, using Railway's `PORT` variable.
3. No new Railway environment variables are required. The current `ADMIN_KEY`, `DATABASE_PATH` and volume must stay in place.
4. Once Online, visit `https://prowelljobs.com/api/health` and confirm an `ok` response, then open the homepage.
5. If a deployment fails, inspect Railway **Deploy Logs**. Revert the *code* change if needed, but do **not** delete the database or volume.

## Step 3 — Test safely

1. Verify the homepage includes broad categories such as Boda Boda & Drivers, Househelps, Farming, Trades, Healthcare, Tech, Finance and others.
2. Filter approved vacancies by categories, countries, job type and pay period.
3. Submit **one clearly marked private TEST vacancy** (use a legitimate test contact) and approve it from `https://prowelljobs.com/admin.html` using the existing private `ADMIN_KEY`.
4. Submit a **test candidate profile** with *non-real contact details*, confirm it is absent publicly while pending, approve it, and check only its nickname/skills/location become public. Use the provided withdrawal code to remove the test profile.
5. Submit a test review and verify that it remains hidden until approved.
6. Verify suspicious-listing reports are visible only in the admin panel.
7. Delete/reject test jobs and reviews through moderation, and check persistent storage across a redeployment.

## Important limitations before wide use

- There are **no employer or job-seeker login accounts** yet. Private employer verification and candidate introductions require manual human checks.
- **Email alert interest** is saved only; **no email notifications are sent**. RSS is live at `https://prowelljobs.com/jobs.rss`.
- Public reviews represent real submitted/approved feedback only. Never publish fake customer testimonials.
- Privacy and Terms content is starter wording. Obtain country-specific legal and data-protection review before large-scale international recruiting.
- Add stronger spam protection, comprehensive monitoring, database backup policies and role-based admin access before scaling.
- If your GitHub repository is public, everything uploaded there is visible. Secrets must stay in Railway Variables only.
