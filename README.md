# Prowell Jobs — Global opportunity platform (expanded MVP)

Website: **https://prowelljobs.com** · Contact: **prowellofficial@gmail.com** · Tel: **+254 703 772 555** / **+254 782 772 996** · CEO: **Mr. Ngugi**

This is an upgrade to the existing Prowell Jobs website running on Railway, with code in `Prowell-dotcom/prowell-jobs`. It supports many kinds of work: informal or casual gigs, ride-hailing and boda boda, domestic work, construction, farming, technical trades, hospitality, logistics, technology, healthcare, education and professional careers worldwide.

## Features included and working

- **32 broad employment sectors** and 12 featured career tiles; keyword, location, country, sector, employment type, arrangement, experience, pay period, currency and min-pay filtering.
- Employer vacancy form: job title, country, location, employer, responsibilities, required skills and qualifications, benefits, application deadline, contact methods, salary range and pay period (hour, day, week, month, year, trip, task, or negotiable).
- **Moderated job postings** (submitted as pending; published only after administrator approval). Separate manual `Verified` badge for employer identities independently checked.
- Candidate profile submissions: nickname, sector, country, city, skills, summary, availability, experience, pay expectation, private email and phone. Profiles do **not** appear until admin approval. Public candidate profile API excludes private email and phone.
- Candidate withdrawal and deletion with a one-time private code shown upon submission.
- Moderated visitor reviews and comments with optional 1–5 star ratings (no invented testimonials).
- Confidential suspicious-listing reporting; admin review queue.
- Career tips and guides, About Us with CEO details, FAQs, Terms of Use, Privacy notice, employer guidance and contact details.
- **Live RSS job feed** at `/jobs.rss` for approved vacancies.
- Email interest signup stores consented preferences for **future** alerts; **automated email sending is not configured**.
- Responsive layouts, original vector illustration (`assets/world-of-work.svg`), colorful category artwork and modern navy/indigo/turquoise styling.

### What is NOT implemented yet

This version does **not** include password-protected employer/job-seeker accounts, direct candidate/employer messaging, CV uploads, automatic candidate matching, automatic employer identity verification, CAPTCHA, automated email alerts, SMS, payments or completed international regulatory compliance reviews. Employers request candidate introductions manually via the Prowell Jobs team. Candidate contacts must not be shared without further explicit permission. Do not claim any official affiliation with ride-hailing services; job titles are descriptive only.

### Production caution

The application collects personal data. Before wide marketing or collecting large numbers of candidate profiles, get a privacy/security and local employment-law review, add email verification and stronger anti-spam/rate limits, role-based authentication, retention controls, backups, and formal employer checks. Domestic workers and vulnerable job seekers merit particular care. The policy pages are starter wording, not legal advice.

## Technology

- Frontend: plain HTML, CSS, JavaScript (no build step).
- Backend: Python standard library `http.server` + SQLite.
- Hosting: Railway with existing persistent volume `/data`.
- Source: GitHub with CI tests in `.github/workflows/check.yml`.

## Run locally

```bash
cd Prowell-Jobs-Upgrade
ADMIN_KEY='your-private-development-key' python server.py
```

On Windows PowerShell:

```powershell
$env:ADMIN_KEY = 'your-private-development-key'
python server.py
```

Open `http://localhost:8000`, then `http://localhost:8000/admin.html`. For an offline design preview, open `index.html` directly: it displays **clearly marked fictional sample listings** and does not publish submissions.

## Run automated tests

```bash
python -m unittest discover -s tests -v
```

The tests cover the old vacancy workflow, broader casual listings, moderation, candidate privacy, withdrawal and deletion, reviews, alerts and reports.

## Updating your existing live site

**Read `UPGRADE-DEPLOYMENT.md` first.** Do not delete your Railway project, volume, domain, database or `ADMIN_KEY`. This code includes an **additive SQLite migration** that keeps old job postings and adds new fields/tables.
