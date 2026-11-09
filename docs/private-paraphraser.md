# Private administrator AI Paraphrasing Studio

The tool is accessible only in the signed-in Prowell Jobs administrator dashboard. It does not modify the existing browser extensions.

## Railway configuration

Under the existing prowell-jobs Railway service, open Variables and add:

- GEMINI_API_KEY: Free-tier Gemini Developer API key from https://aistudio.google.com/apikey . This replaces the requirement for OPENAI_API_KEY.
- Optional PARAPHRASER_PROVIDER: gemini (default). To use OpenAI instead, explicitly set openai and provide OPENAI_API_KEY.
- Optional GEMINI_MODEL: gemini-3.8-flash (default). Set another Google-supported, free-tier model if your project does not offer this model.
- Optional PARAPHRASER_MODEL: gpt-4.1, only used when explicitly selecting OpenAI.

Never place provider API keys in HTML, JavaScript or GitHub.

When logged in, press **Test Gemini connection** in the private studio. It sends the fixed word READY (never your draft) to check the active model and key, then shows a safe configuration or quota error. If PARAPHRASER_PROVIDER is set to openai, remove it or set it to gemini. If the default model is unavailable for your Google AI Studio project, set GEMINI_MODEL to one listed as available for that project. Do not put quote marks around a Railway API key.

Deploy the updated GitHub main commit. Sign in to the Prowell admin dashboard and use My private AI Paraphrasing Studio. Enter any nonempty text up to 3,000 words, choose a style, then select Paraphrase. Copy or download as TXT.

## Security and limitations

- POST /api/admin/paraphrase accepts only authenticated administrator sessions with the session CSRF token.
- The Prowell application does not store source or rewritten text in its database, but text is transmitted to the configured AI provider for processing.
- Requests are rate-limited; input and output each have a maximum of 3,000 words.
- Provider credentials stay in server environment variables. Gemini free-tier input and output are free only while within that project's current allocation; the free tier is rate-limited and availability varies by account, region and model. Optional OpenAI usage may incur charges.
- Google states that free-tier Gemini content may be used to improve its products. Avoid sending private or confidential client content without appropriate authorization. For stricter data handling, review Google's paid-tier terms and applicable privacy requirements.
- The tool uses a two-step editorial workflow: a natural rewrite followed by a grammar and fluency review. It compares numbers, citations, quoted passages, DOIs and URLs with the source before returning output.
- If critical data changes, the tool attempts a targeted repair. If the polished version fails safeguards, it returns the verified draft instead. The system still cannot independently guarantee that every meaning is preserved or every sentence is perfect.
- Review factual accuracy, references, and any required AI-use disclosure before submitting text.

Run local tests: python -m unittest discover -s tests -p 'test_admin_paraphraser.py' -v.
