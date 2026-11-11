#!/bin/sh
set -eu

export OLLAMA_HOST="${OLLAMA_HOST:-[::]:11434}"
MODEL="${PROWELL_MODEL_TO_PULL:-llama3.2:3b}"

printf 'Starting private Prowell model service.\n'
ollama serve &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' INT TERM
READY=0

# The official image starts without a model; initialize it into the mounted
# /root/.ollama volume before allowing DeepRewrite to become available.
ATTEMPT=0
while [ "$ATTEMPT" -lt 90 ]; do
  if ollama list >/dev/null 2>&1; then
    READY=1
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 2
done
if [ "$READY" -ne 1 ]; then
  printf 'Ollama failed to open its local API.\n' >&2
  exit 1
fi

# A persistent volume avoids re-downloading weights on ordinary restarts.
if ! ollama list | grep -Fq "$MODEL"; then
  printf 'Downloading configured local model %s into persistent storage...\n' "$MODEL"
  if ! ollama pull "$MODEL"; then
    printf 'Model download failed; restart the service when resources are available.\n' >&2
    exit 1
  fi
fi
printf 'Private model %s is ready for inference.\n' "$MODEL"
wait "$SERVER_PID"
