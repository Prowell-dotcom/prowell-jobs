FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY index.html jobs.html account.html dashboard.html writing.html writing-admin.html admin.html ./
COPY styles.css membership.css public-paraphraser.css public-paraphraser.js writing.css app.js member.js admin-account.js writing.js writing-admin.js admin.js admin-paraphraser.js admin-documents.js admin-documents.html favicon.svg robots.txt sitemap.xml ./
COPY server.py notifications.py accounts.py writing_marketplace.py admin_document_sender.py admin_extension_store.py good_writers_reporting.py admin_paraphraser.py prowell_deeprewrite.py ./
COPY extension/4writers/ ./extension/4writers/
COPY extension/good-writers/ ./extension/good-writers/
COPY extension/dual-writers/ ./extension/dual-writers/
COPY assets/ ./assets/
# This is a deployment gate, not a post-deploy warning. A failing test
# prevents Docker from producing an image for Railway to promote.
COPY tests/ ./tests/
RUN python -m compileall -q server.py admin_paraphraser.py prowell_deeprewrite.py tests \
    && python -m unittest discover -s tests -q
EXPOSE 8000
CMD ["python", "server.py"]
