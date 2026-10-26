# Sandbox image for Python packages. sitecustomize.py and run.sh are
# bind-mounted read-only at /trustlens at run time.
FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends faketime  && rm -rf /var/lib/apt/lists/*  && pip install --no-cache-dir setuptools==75.6.0 wheel==0.45.1 \
 && useradd -m -u 1001 -s /bin/bash dev
ENV HOME=/home/dev USER=dev PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /work
USER dev
