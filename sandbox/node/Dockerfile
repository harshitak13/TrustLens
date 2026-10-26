# Sandbox image for npm packages. The hook, run script and CA cert are
# bind-mounted read-only at /trustlens at run time, so iterating on them
# needs no rebuild.
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends faketime strace ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Fake developer home; the real contents (honeytokens) are mounted per scan.
RUN useradd -m -u 1001 -s /bin/bash dev
ENV HOME=/home/dev USER=dev \
    npm_config_cache=/tmp/.npm npm_config_update_notifier=false \
    NODE_EXTRA_CA_CERTS=/trustlens/ca.pem
WORKDIR /work
USER dev
