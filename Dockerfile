FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY index.html jobs.html account.html dashboard.html writing.html writing-admin.html admin.html ./
COPY styles.css membership.css writing.css app.js member.js admin-account.js writing.js writing-admin.js admin.js favicon.svg robots.txt sitemap.xml ./
COPY server.py notifications.py accounts.py writing_marketplace.py ./
COPY assets/ ./assets/
EXPOSE 8000
CMD ["python", "server.py"]
