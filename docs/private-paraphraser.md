# Private administrator AI Paraphrasing Studio

The tool is accessible only in the signed-in Prowell Jobs administrator dashboard. It does not modify the existing browser extensions.

## Railway configuration

Under the existing prowell-jobs Railway service, open Variables and add:

- OPENAI_API_KEY: A private OpenAI API key from an API account with billing enabled. Never place it in GitHub, HTML, or JavaScript.
- Optional PARAPHRASER_MODEL: Model ID for text rewriting; defaults to gpt-4.1.

Deploy the updated GitHub main commit. Sign in to the Prowell admin dashboard and use My private AI Paraphrasing Studio. Enter any nonempty text up to 3,000 words, choose a style, then select Paraphrase. Copy or download as TXT.

## Security and limitations

- POST /api/admin/paraphrase accepts only authenticated administrator sessions with the session CSRF token.
- The Prowell application does not store source or rewritten text in its database, but text is transmitted to the configured AI provider for processing.
- Requests are rate-limited; input and output each have a maximum of 3,000 words.
- Provider credentials stay in server environment variables. Requests incur API charges.
- The tool uses a two-step editorial workflow: a natural rewrite followed by a grammar and fluency review. It compares numbers, citations, quoted passages, DOIs and URLs with the source before returning output.
- If critical data changes, the tool attempts a targeted repair. If the polished version fails safeguards, it returns the verified draft instead. The system still cannot independently guarantee that every meaning is preserved or every sentence is perfect.
- Review factual accuracy, references, and any required AI-use disclosure before submitting text.

Run local tests: python -m unittest discover -s tests -p 'test_admin_paraphraser.py' -v.
