FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install Python deps first for better layer caching
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the rest of the repo
COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

# Run via sh so the script does not need the execute bit (the api service
# mounts the host repo over /app, which may not preserve file modes).
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
