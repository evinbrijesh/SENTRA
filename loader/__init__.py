"""Sentra — Data Loader.

Reads CSV batches and loads them into Postgres (row-level truth: accounts,
transactions, payment methods) and Neo4j (relationship layer: account-device,
account-ip, referral edges).

This loader is the single ingestion path for BOTH the initial dataset and any
later batch re-run via `/ingest` — keeping detection "re-runnable on new batches"
without a second code path.
"""
