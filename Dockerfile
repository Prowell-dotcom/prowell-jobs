FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Explicitly include all app modules and public pages. The previous Dockerfile
# omitted writing_marketplace.py, causing ModuleNotFoundError at startup.
COPY index.html jobs.html account.html dashboard.html admin.html writing.html writing-admin.html \
     styles.css membership.css writing.css \
     app.js member.js admin.js writing.js writing-admin.js \
     favicon.svg robots.txt sitemap.xml \
     server.py notifications.py accounts.py writing_marketplace.py ./
COPY assets/ ./assets/

EXPOSE 8000
CMD ["python", "server.py"]
