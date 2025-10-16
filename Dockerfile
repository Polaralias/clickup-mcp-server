# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS base
WORKDIR /app

FROM ghcr.io/astral-sh/uv:0.5.16 AS uv

FROM base AS builder
WORKDIR /app
COPY . .
COPY --from=uv /uv /bin/uv
RUN if [ -f "uv.lock" ]; then \
        echo "Using uv with uv.lock" && \
        export UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy && \
        uv sync --locked --no-dev; \
    elif [ -f "poetry.lock" ]; then \
        echo "Using poetry with poetry.lock" && \
        export PYTHONUNBUFFERED=1 \ \
            PYTHONDONTWRITEBYTECODE=1 \ \
            PIP_NO_CACHE_DIR=off \ \
            PIP_DISABLE_PIP_VERSION_CHECK=on \ \
            POETRY_HOME="/opt/poetry" \ \
            POETRY_VIRTUALENVS_IN_PROJECT=true \ \
            POETRY_NO_INTERACTION=1 && \
        export PATH="$POETRY_HOME/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" && \
        pip install poetry && \
        poetry install --no-dev; \
    else \
        echo "Using uv with pyproject.toml" && \
        export UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy && \
        uv sync --no-dev; \
    fi

FROM base AS final
WORKDIR /app
COPY --from=uv /uv /bin/uv
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH"
CMD ["uv", "run", "python", "-m", "smithery.cli.start"]
