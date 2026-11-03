# Prowell Jobs small-deployment container. A separate production hardening review is needed before public launch.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY index.html styles.css app.js favicon.svg admin.html admin.js server.py ./
EXPOSE 8000
CMD ["python", "server.py"]
