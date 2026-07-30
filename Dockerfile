FROM python:3.12-slim

WORKDIR /app

# System deps for geospatial/netcdf stacks (rasterio, netcdf4, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    gcc \
    g++ \
    libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install --no-cache-dir uv

# Install Python deps (cache-friendly layer)
COPY pyproject.toml uv.lock /app/
RUN uv sync --frozen

# Copy the rest of the project
COPY . /app/

# Default configuration (override with env vars)
ENV INPUT_DIR=/data/ \
    OUTPUT_DIR=/catalog \
    WATCH_DEBOUNCE=10

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]

