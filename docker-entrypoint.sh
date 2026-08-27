#!/usr/bin/env bash
# Sentra API container entrypoint.
# Bootstraps data + model on first start, loads the initial batch into the
# databases (best-effort), then serves the FastAPI app.
set -e

echo "[entrypoint] ensuring synthetic data exists..."
python -m evaluation.split || echo "[entrypoint] WARN: easy data generation failed"

echo "[entrypoint] generating hard-mode dataset..."
python -m data.generator.generate_hard || echo "[entrypoint] WARN: hard data generation failed"

echo "[entrypoint] training detection model (easy + hard, dual held-out eval)..."
python -m detection.train || echo "[entrypoint] WARN: training failed"

echo "[entrypoint] loading initial batch into databases (best-effort)..."
python -m loader.load --data-dir data/raw --batch initial \
  || echo "[entrypoint] WARN: initial load failed (databases may be unreachable)"

echo "[entrypoint] starting API on :8000"
exec uvicorn api.main:app --host 0.0.0.0 --port 8000
