FROM ollama/ollama:0.32.0
COPY services/ollama/bootstrap.sh /usr/local/bin/prowell-ollama-bootstrap.sh
RUN chmod 0755 /usr/local/bin/prowell-ollama-bootstrap.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/prowell-ollama-bootstrap.sh"]
