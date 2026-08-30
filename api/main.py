"""
Sentra FastAPI — serves detection results, ingestion, and evaluation.

Routes (served after the dashboard's /api proxy strips the prefix):
  GET  /health                      service + DB status
  GET  /rings                       all flagged/review rings
  GET  /rings/{id}                  ring detail + shared entities
  GET  /rings/{id}/subgraph         Cytoscape nodes/edges
  POST /ingest                      new batch (zip of CSVs) -> loader -> re-detect
  GET  /evaluate                    held-out test metrics + false-positive cost

Run locally:
    uvicorn api.main:app --reload
Or via Docker Compose.
"""

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import db
from api.routes import alerts as alerts_routes
from api.routes import audit as audit_routes
from api.routes import evaluate as evaluate_routes
from api.routes import feedback as feedback_routes
from api.routes import ingest as ingest_routes
from api.routes import rings as rings_routes

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("api.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Sentra API starting")
    yield
    db.close_dbs()
    log.info("Sentra API stopped")


app = FastAPI(title="Sentra Fraud-Ring Detector", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:80",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.middleware("http")
async def request_logger(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    dur_ms = (time.perf_counter() - start) * 1000
    log.info("%s %s -> %s (%.1f ms)", request.method, request.url.path, response.status_code, dur_ms)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.error("unhandled error on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"error": "Internal server error", "detail": str(exc)})


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "sentra-api",
        "postgres": db.pg_available(),
        "neo4j": db.neo4j_available(),
    }


app.include_router(rings_routes.router)
app.include_router(ingest_routes.router)
app.include_router(evaluate_routes.router)
app.include_router(audit_routes.router)
app.include_router(alerts_routes.router)
app.include_router(feedback_routes.router)


@app.get("/")
def root():
    return {
        "name": "Sentra Fraud-Ring Detector",
        "endpoints": [
            "/health",
            "/rings",
            "/rings/{id}",
            "/rings/{id}/subgraph",
            "/rings/{id}/decision",
            "/ingest",
            "/evaluate",
            "/audit",
            "/audit/verify",
            "/alerts",
            "/alerts/webhook/test",
        ],
        "docs": "/docs",
    }
