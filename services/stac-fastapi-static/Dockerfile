# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG PYTHON_VERSION=3.12
# Pinned by digest (python:3.12-alpine at pin time). Re-pin on bump: bump the
# version, then docker inspect --format '{{index .RepoDigests 0}}' python:3.12-alpine.
ARG PYTHON_DIGEST=@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a

FROM python:${PYTHON_VERSION}-alpine${PYTHON_DIGEST} AS build

# uv is installed from PyPI (pinned version), NOT from a downloaded install
# script — the astral.sh installer is an unpinned remote-execution hole.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install uv==0.12.15

WORKDIR /app

COPY ./pyproject.toml ./pyproject.toml
COPY ./uv.lock ./uv.lock

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --compile --locked --no-install-project --no-default-groups

FROM python:${PYTHON_VERSION}-alpine${PYTHON_DIGEST}

WORKDIR /app

ENV PYTHONPATH="/app/"

COPY --from=build /app/pyproject.toml ./pyproject.toml
COPY --from=build /app/.venv ./.venv

COPY ./README.md ./README.md
COPY ./LICENCE.txt ./LICENCE.txt
COPY ./stac_fastapi ./stac_fastapi

ENTRYPOINT [".venv/bin/python", "stac_fastapi/static/app.py"]