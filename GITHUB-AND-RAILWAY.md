# Publish Prowell Jobs to GitHub and Railway

## A. Create your GitHub repository

1. Log in to **https://github.com** using your own account.
2. Visit **https://github.com/new**.
3. Repository name: `prowell-jobs`.
4. Choose **Private** initially. You can decide later whether to make the source public.
5. Leave “Add a README” **unchecked**, since this package already contains one.
6. Click **Create repository**.

### Option 1: Upload in a browser (easy)

1. Download `Prowell-Jobs-GitHub-Ready.zip` from the ChatGPT conversation and extract it on your computer.
2. Open the **contents of the extracted project folder**, select all its files and subfolders (including `.github` and `.gitignore`) and drag them to the new repository's upload area. Or choose **Add file → Upload files** on an existing repository.
3. Review the upload list. At the top level of the repository, you should have `Dockerfile`, `server.py`, `index.html`, `app.js`, and `README.md`. `.github/workflows/check.yml` should also be present.
4. Add a commit message such as `Initial Prowell Jobs website` and complete the commit.
5. **Do not upload the ZIP itself, any `.env` file, or any `.sqlite3` database.**

GitHub web-upload help: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository

### Option 2: Push using Git (recommended for future updates)

From the **extracted project directory** (where `Dockerfile` is), run:

```bash
git init
git add .
git commit -m "Initial Prowell Jobs website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/prowell-jobs.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your own GitHub username. GitHub authentication may ask you to sign in through Git Credential Manager or use another secure method. Never send an access token in a chat or commit it into code.

## B. Deploy the repository to Railway

1. Sign in to **https://railway.com/dashboard**.
2. Click **New Project → Deploy from GitHub repo**.
3. Authorize Railway to access your GitHub account, and select `prowell-jobs`.
4. Select **Add Variables** before the first deployment if offered.
5. Add `ADMIN_KEY` using a long random secret you generate and keep **only** in Railway Variables and your password manager. It is not included in the repository. The app intentionally refuses to start on Railway if the key is missing.
6. In the Railway service add a **persistent volume** mounted at `/data`.
7. Add the variable `DATABASE_PATH=/data/prowell-jobs.sqlite3` to the same service.
8. Review staged changes and select **Deploy**. Railway automatically detects the root `Dockerfile`.
9. Create a temporary Railway-provided public domain for testing. Visit `https://YOUR-RAILWAY-URL/api/health` and confirm it returns `{"status":"ok"}`.

**Keep the SQLite-based service at one replica.** Without the mounted volume, data can be lost after deployments. See https://docs.railway.com/services and https://docs.railway.com/quick-start for official instructions.

## C. Connect your purchased prowelljobs.com

If you purchased `prowelljobs.com` **through Railway**, open the Domains area in your Railway workspace and assign the domain to the website service. If purchased elsewhere, go to your web service's **Settings → Networking → Custom Domain**, enter `prowelljobs.com`, and create only the DNS records Railway actually instructs you to set at the registrar. DNS changes and HTTPS provisioning may take time. Don't guess record values.

Confirm that `https://prowelljobs.com` and `https://prowelljobs.com/api/health` work, and test `www.prowelljobs.com` separately if you want that hostname.

## D. Before accepting real postings

- Make sure `ADMIN_KEY` is private, and that you can log into the admin page securely over HTTPS.
- Create a test job posting and verify it starts **pending**, then approve it and verify it appears publicly.
- Verify persistent storage survives a deployment or restart.
- Add privacy policy, terms, employer verification, spam protection, abuse reporting, regular backups, and a production-grade HTTP server before widely advertising the service.

## Deployment checklist

- [ ] Code uploaded to a GitHub repository that you own
- [ ] GitHub Actions checks pass
- [ ] Railway connected to repository
- [ ] Strong private `ADMIN_KEY` set in Railway
- [ ] Persistent storage volume attached and `DATABASE_PATH` set
- [ ] Railway deployment successful
- [ ] `prowelljobs.com` connected and HTTPS works
- [ ] Test posting and approval complete

## Secrets

**Never** upload passwords, payment details, authorization tokens, domain credentials, or user data to GitHub. `.gitignore` helps prevent accidental inclusion but cannot protect you from manually forcing a secret into a commit.
