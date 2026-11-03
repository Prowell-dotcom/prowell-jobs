# Prowell Jobs

**Prowell Jobs** is a mobile-friendly job vacancy website with an employer submission form and an administrator approval workflow.

- Planned website: **https://prowelljobs.com** (domain purchased by owner; deployment not yet confirmed)
- General contact: **prowellofficial@gmail.com**
- Stack: HTML, CSS, JavaScript, Python, SQLite, Docker
- Hosting target: **Railway**, deployed from **GitHub**

> **Status:** Working MVP, not yet a fully hardened recruitment service. No sample job listings should be presented as confirmed live vacancies.

## Features

- Search and filter job postings by keyword, location, category, job type, arrangement, and experience level
- Save jobs in the visitor's own browser
- Employer submission form
- Pending/approved/rejected job moderation
- Administrator review at `/admin.html`
- SQLite persistence and `/api/health` endpoint
- Responsive layout for desktop and mobile

## Test locally

Python 3.10+ is required. No third-party Python dependencies.

**macOS or Linux**

```bash
export ADMIN_KEY="your-own-long-random-admin-password"
python3 server.py
```

**Windows PowerShell**

```powershell
$env:ADMIN_KEY = "your-own-long-random-admin-password"
python server.py
```

Open http://localhost:8000. The administration page is http://localhost:8000/admin.html.
To run the included automated tests:

```bash
python -m unittest discover -s tests -v
```

## Upload to GitHub and deploy

Follow **[GITHUB-AND-RAILWAY.md](GITHUB-AND-RAILWAY.md)** for exact steps to create your private repository, push or upload the code, connect the repository to Railway, secure the administrator credentials, preserve submitted jobs with a mounted volume, and associate your purchased domain.

**Do not upload just the ZIP to GitHub.** Extract it first and upload the files inside the project folder. The `Dockerfile` must be at the root of the repository for automatic detection.

## Environment variables

| Name | Purpose |
| --- | --- |
| `ADMIN_KEY` | **Required on Railway.** A unique private key for administrator access. Never commit it. |
| `DATABASE_PATH` | Set to `/data/prowell-jobs.sqlite3` when a Railway volume is mounted at `/data`. |
| `PORT` | Railway supplies this automatically; defaults to `8000` locally. |

Database files (`*.sqlite3`), `.env` secrets, and Python caches are excluded using `.gitignore`.

## API summary

- `GET /api/health` — health check
- `GET /api/jobs` — approved jobs
- `POST /api/jobs` — create pending job submission
- `GET /api/admin/jobs` — all submissions (requires bearer admin key)
- `PATCH /api/admin/jobs/<id>` — approve or reject (requires bearer admin key)

## Important before public launch

This version is an MVP and needs additional hardening before inviting real public traffic: employer and vacancy identity verification, privacy and terms pages, scam reporting, abuse prevention, backups, monitoring, and a production-grade HTTP server. The current Python standard-library web server is not designed for an unrestricted high-traffic public platform. Job applications currently go to the employer's own email address or external URL; this project does not collect applicants' CVs. The platform contact is a `mailto:` link, not an automatic email messaging service.
