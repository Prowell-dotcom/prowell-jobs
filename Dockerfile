FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY index.html jobs.html account.html dashboard.html styles.css membership.css app.js member.js admin.html admin.js favicon.svg robots.txt sitemap.xml server.py notifications.py accounts.py ./
COPY assets/ ./assets/
EXPOSE 8000
CMD ["python", "server.py"]
