# Prowell DeepRewrite — private model setup

## Deployment status and limitations

The DeepRewrite code is not equivalent to an installed language model.
It stays disabled until a separate private Ollama service is running with
a model loaded. The public Fast editing engine continues to work without
a model, API key or account.

The design draws on controlled generation and candidate selection. It does
NOT implement or bundle the original trained checkpoints for LingConv,
AESOP, SynPG, VQ-VAE, pretrained NLI or AlignScore, and does not claim
that results will evade any AI detector.

## Configure on Railway

1. Create a new Railway service named ollama in this project. Connect it to
   the same GitHub repository Prowell-dotcom/prowell-jobs and branch main.
   Configure its Dockerfile path as services/ollama/Dockerfile (leave root
   directory empty so COPY resolves services/ollama/bootstrap.sh).
2. Attach a 5 GB persistent volume at /root/.ollama. This stores model
   weights between deployments.
3. Allocate suitable CPU/RAM resources; llama3.2:3b usually benefits from
   approximately 6 GB RAM headroom and at least 2 vCPUs on CPU hosts.
4. Set these variables on the Ollama service:

    OLLAMA_HOST=[::]:11434
    OLLAMA_NO_CLOUD=1
    OLLAMA_CONTEXT_LENGTH=4096
    OLLAMA_NUM_PARALLEL=1
    OLLAMA_MAX_LOADED_MODELS=1
    OLLAMA_KEEP_ALIVE=10m
    PROWELL_MODEL_TO_PULL=llama3.2:3b

5. Do NOT add a public domain or TCP proxy to the model service. The
   bundled bootstrap.sh starts the Ollama server and downloads the model
   automatically on the first startup, keeping it on the mounted volume.
   Monitor service deploy logs until the line "Private model ... is ready."
   appears.

6. Set these variables on the existing Prowell Jobs WEB service:

    PROWELL_DEEPREWRITE_ENABLED=1
    PROWELL_OLLAMA_URL=http://ollama.railway.internal:11434
    PROWELL_OLLAMA_MODEL=llama3.2:3b
    PROWELL_OLLAMA_THREADS=4

   Use your Ollama service name if it is not called ollama. Configure
   threads to match actual CPU resources.

7. Redeploy the website. The homepage checks its own public capability
   endpoint /api/paraphrase/capabilities, which probes the private
   Ollama model list. It only enables DeepRewrite if the model is present.

## What actually runs

1. Source analysis: capture paragraph, tone, level, citations and protected
   details. These are heuristic extracts, not a pretrained semantic parser.
2. Meaning and wording separation: immutable placeholders replace numeric
   figures, quotations, medicines, citations, symbols and user-protected terms.
3. Sentence planning: choose distinct linguistic directions in the prompt.
   This is inspired by controlled generation, not the LingConv/AESOP models.
4. Candidate generation: call the private Ollama model for 4 alternatives
   for up to 170 words or 2 for 171–350 words (to cap latency).
5. Consistency checks: reject missing/altered protected facts, changed
   negations/qualifiers, unsupported vocabulary drift and obvious grammar
   problems. NLI and AlignScore pretrained models are NOT installed.
6. Ranking: compare valid candidates for topic coverage, naturalness
   heuristics, readable length and lexical diversity.
7. Iteration: the Rehumanize button sends the current result and up to
   three earlier versions. The original is kept intact.

## Safety and privacy

- All model requests travel over Railway's private internal network.
- The browser does not receive the private model address.
- No external commercial LLM API, third-party inference key or
  AI detector integration is required.
- Strict rate limit: 6 deep model requests per hour per connection,
  in addition to the global 24 public editing requests per hour.
- 350 words maximum in DeepRewrite (3,000 in Fast editing).
- CPU-based generation may take many seconds. The frontend displays
  activity and a separate failure message instead of pretending that
  waiting guarantees better quality.
- The model and quality checks can still introduce or miss factual
  errors, especially implications, so human proofreading is required.
- Turn off immediately with PROWELL_DEEPREWRITE_ENABLED=0 and redeploy.

## Sources

LingConv: https://aclanthology.org/2025.findings-emnlp.1137/
AESOP: https://aclanthology.org/2021.emnlp-main.420/
SynPG: https://aclanthology.org/2021.eacl-main.88/
AlignScore: https://aclanthology.org/2023.acl-long.634/
Railway private networking: https://docs.railway.com/networking/private-networking/how-it-works
Ollama generate API: https://github.com/ollama/ollama/blob/main/docs/api.md
