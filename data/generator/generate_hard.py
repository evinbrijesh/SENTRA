"""
Sentra — Hard-Mode Ring Generator

Generates a dataset with deliberately subtler fraud rings to test
graceful degradation. These rings are harder to detect than the
baseline (data/raw/) because they lack the clean signals the
detector currently relies on.

Hard ring characteristics vs baseline:
- Partial device overlap (50% on shared device vs 80%)
- Partial IP overlap (40% on shared IP vs 75%)
- Longer signup burst (6-24 hours vs 15-120 minutes)
- NO referral cycle (sparse random referrals only)
- Lower referral density (10% vs 30%)

Run: python -m data.generator.generate_hard
"""

import json
import os
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from faker import Faker

# ── Hard ring config (mirrors config.py structure) ────────────
TOTAL_ACCOUNTS = 500
NUM_RINGS = 3
RING_SIZE_MIN = 10
RING_SIZE_MAX = 25

TIME_START = "2025-01-01 00:00:00"
TIME_END = "2025-03-31 23:59:59"

# Hard ring burst: 6-24 hours (much longer than baseline's 15-120 min)
HARD_BURST_MINUTES_MIN = 360   # 6 hours
HARD_BURST_MINUTES_MAX = 1440  # 24 hours

ACCOUNT_PREFIX = "ACC"
DEVICE_PREFIX = "DEV"

NORMAL_KYC_WEIGHTS = {"VERIFIED": 0.85, "PENDING": 0.10, "REJECTED": 0.05}
RING_KYC_WEIGHTS = {"VERIFIED": 0.15, "PENDING": 0.70, "REJECTED": 0.15}

NORMAL_TXN_MIN = 50
NORMAL_TXN_MAX = 10_000
RING_TXN_MIN = 10
RING_TXN_MAX = 200

NORMAL_DEVICE_SHARING_PROB = 0.04
NORMAL_IP_SHARING_PROB = 0.04
NORMAL_SHARED_GROUP_MAX = 3
NORMAL_REFERRAL_PROB = 0.15

# Hard ring: partial overlap (50% device, 40% IP — much weaker signal)
HARD_SHARED_DEVICE_PROB = 0.50
HARD_SHARED_IP_PROB = 0.40

# Hard ring: NO referral cycle, just sparse random referrals
HARD_REFERRAL_PROB = 0.10  # same as normal — no dense loop
HARD_REFERRAL_DENSITY = 0.10  # sparse, not 0.30

RING_DEVICE_ID_MIN = 10000
RING_DEVICE_ID_MAX = 19999

UPI_PROBABILITY = 0.70

SEED = 42  # same seed family as baseline for reproducibility

# ── Helpers (same as baseline generator) ──────────────────────
fake = Faker()
Faker.seed(SEED)
random.seed(SEED)
np.random.seed(SEED)

TIME_START_DT = datetime.strptime(TIME_START, "%Y-%m-%d %H:%M:%S")
TIME_END_DT = datetime.strptime(TIME_END, "%Y-%m-%d %H:%M:%S")


def _id(prefix: str, seq: int) -> str:
    return f"{prefix}-{seq:04d}"


def _random_ip() -> str:
    while True:
        octets = [random.randint(1, 223) for _ in range(4)]
        if octets[0] == 10:
            continue
        return ".".join(str(o) for o in octets)


def _kyc_status(weights: dict) -> str:
    return random.choices(
        list(weights.keys()), weights=list(weights.values()), k=1
    )[0]


def _random_datetime(start: datetime, end: datetime) -> datetime:
    delta = end - start
    random_seconds = random.randint(0, int(delta.total_seconds()))
    return start + timedelta(seconds=random_seconds)


# ── Generators ────────────────────────────────────────────────

def _generate_normal_accounts(count: int) -> pd.DataFrame:
    accounts = []
    for i in range(count):
        signup_time = _random_datetime(TIME_START_DT, TIME_END_DT)
        accounts.append({
            "account_id": _id(ACCOUNT_PREFIX, i + 1),
            "signup_time": signup_time.strftime("%Y-%m-%d %H:%M:%S"),
            "kyc_status": _kyc_status(NORMAL_KYC_WEIGHTS),
            "is_ring": False,
            "ring_id": None,
        })
    return pd.DataFrame(accounts)


def _generate_hard_ring(start_seq: int, ring_id: int) -> tuple[pd.DataFrame, dict]:
    """Generate a hard ring: partial overlap, longer burst, no cycle."""
    size = random.randint(RING_SIZE_MIN, RING_SIZE_MAX)
    burst_minutes = random.randint(HARD_BURST_MINUTES_MIN, HARD_BURST_MINUTES_MAX)

    ring_start = _random_datetime(
        TIME_START_DT + timedelta(days=7),
        TIME_END_DT - timedelta(days=7),
    )
    burst_seconds = burst_minutes * 60

    shared_device = _id(DEVICE_PREFIX, random.randint(500, 9999))
    shared_ip = _random_ip()

    accounts = []
    for i in range(size):
        offset = random.randint(0, burst_seconds)
        signup_time = ring_start + timedelta(seconds=offset)

        has_shared_device = random.random() < HARD_SHARED_DEVICE_PROB
        has_shared_ip = random.random() < HARD_SHARED_IP_PROB

        accounts.append({
            "account_id": _id(ACCOUNT_PREFIX, start_seq + i),
            "signup_time": signup_time.strftime("%Y-%m-%d %H:%M:%S"),
            "kyc_status": _kyc_status(RING_KYC_WEIGHTS),
            "is_ring": True,
            "ring_id": ring_id,
            "_shared_device": shared_device if has_shared_device else None,
            "_shared_ip": shared_ip if has_shared_ip else None,
        })

    ring_meta = {
        "ring_id": ring_id,
        "size": size,
        "shared_device": shared_device,
        "shared_ip": shared_ip,
        "burst_start": ring_start.strftime("%Y-%m-%d %H:%M:%S"),
        "burst_end": (ring_start + timedelta(seconds=burst_seconds)).strftime("%Y-%m-%d %H:%M:%S"),
    }

    return pd.DataFrame(accounts), ring_meta


def _assign_devices(accounts: pd.DataFrame) -> pd.DataFrame:
    device_ids = []
    for i, row in accounts.iterrows():
        if row["is_ring"]:
            device_ids.append(
                row.get("_shared_device")
                or _id(DEVICE_PREFIX, random.randint(RING_DEVICE_ID_MIN, RING_DEVICE_ID_MAX))
            )
        else:
            device_ids.append(_id(DEVICE_PREFIX, i + 1))
    accounts["device_id"] = device_ids

    normal_indices = list(accounts[~accounts["is_ring"]].index)
    random.shuffle(normal_indices)
    num_overlap = int(len(normal_indices) * NORMAL_DEVICE_SHARING_PROB)
    overlap_indices = normal_indices[:num_overlap]

    for start in range(0, len(overlap_indices), NORMAL_SHARED_GROUP_MAX):
        group = overlap_indices[start:start + NORMAL_SHARED_GROUP_MAX]
        if len(group) >= 2:
            shared_device = _id(DEVICE_PREFIX, random.randint(1, 499))
            for idx in group:
                accounts.at[idx, "device_id"] = shared_device

    return accounts


def _assign_ips(accounts: pd.DataFrame) -> pd.DataFrame:
    ip_ids = []
    for i, row in accounts.iterrows():
        if row["is_ring"]:
            ip_ids.append(row.get("_shared_ip") or _random_ip())
        else:
            ip_ids.append(_random_ip())
    accounts["ip_address"] = ip_ids

    normal_indices = list(accounts[~accounts["is_ring"]].index)
    random.shuffle(normal_indices)
    num_overlap = int(len(normal_indices) * NORMAL_IP_SHARING_PROB)
    overlap_indices = normal_indices[:num_overlap]

    for start in range(0, len(overlap_indices), NORMAL_SHARED_GROUP_MAX):
        group = overlap_indices[start:start + NORMAL_SHARED_GROUP_MAX]
        if len(group) >= 2:
            shared_ip = _random_ip()
            for idx in group:
                accounts.at[idx, "ip_address"] = shared_ip

    return accounts


def _generate_payment_methods(accounts: pd.DataFrame) -> pd.DataFrame:
    methods = []
    for _, row in accounts.iterrows():
        if random.random() < UPI_PROBABILITY:
            name = fake.user_name()[:12]
            bank = random.choice(["okhdfcbank", "okicicibank", "okaxisbank", "oksbi", "paytm"])
            handle = f"{name}@{bank}"
            methods.append({
                "account_id": row["account_id"],
                "payment_method_type": "UPI",
                "payment_method_id": handle,
            })
        else:
            prefix = random.choice(["411122", "523456", "371234", "601100"])
            suffix = f"{random.randint(1000, 9999)}"
            card = f"{prefix}******{suffix}"
            methods.append({
                "account_id": row["account_id"],
                "payment_method_type": "CARD",
                "payment_method_id": card,
            })
    return pd.DataFrame(methods)


def _generate_transactions(accounts: pd.DataFrame) -> pd.DataFrame:
    txns = []
    for i, row in accounts.iterrows():
        if row["is_ring"]:
            amount = round(random.uniform(RING_TXN_MIN, RING_TXN_MAX), 2)
        else:
            amount = round(random.uniform(NORMAL_TXN_MIN, NORMAL_TXN_MAX), 2)
        signup = datetime.strptime(row["signup_time"], "%Y-%m-%d %H:%M:%S")
        txn_time = signup + timedelta(hours=random.randint(1, 48))
        txns.append({
            "transaction_id": _id("TXN", i + 1),
            "account_id": row["account_id"],
            "amount": amount,
            "timestamp": txn_time.strftime("%Y-%m-%d %H:%M:%S"),
        })
    return pd.DataFrame(txns)


def _generate_referrals(accounts: pd.DataFrame, ring_metas: list[dict]) -> pd.DataFrame:
    """Referrals: normal = sparse acyclic. Hard rings = sparse random (NO cycle)."""
    referrals = []
    all_normal = accounts[~accounts["is_ring"]].to_dict("records")
    all_accounts = accounts.to_dict("records")

    # Normal referrals: sparse, no cycles
    referred_set = set()
    for acc in all_normal:
        if random.random() < NORMAL_REFERRAL_PROB:
            candidates = [
                a for a in all_normal
                if a["account_id"] != acc["account_id"]
                and a["signup_time"] < acc["signup_time"]
                and a["account_id"] not in referred_set
            ]
            if candidates:
                referrer = random.choice(candidates)
                referrals.append({
                    "referrer_id": referrer["account_id"],
                    "referred_id": acc["account_id"],
                    "is_ring_referral": False,
                    "ring_id": None,
                })
                referred_set.add(acc["account_id"])

    # Hard ring referrals: sparse, NO cycle (just random forward refs)
    for meta in ring_metas:
        ring_accounts = [
            a for a in all_accounts if a.get("ring_id") == meta["ring_id"]
        ]
        ring_ids = [a["account_id"] for a in ring_accounts]

        # Sparse random referrals (no guaranteed cycle)
        for j in range(len(ring_ids)):
            for k in range(j + 1, len(ring_ids)):
                if random.random() < HARD_REFERRAL_DENSITY:
                    referrals.append({
                        "referrer_id": ring_ids[j],
                        "referred_id": ring_ids[k],
                        "is_ring_referral": True,
                        "ring_id": meta["ring_id"],
                    })

    return pd.DataFrame(referrals)


def _generate_devices_table(accounts: pd.DataFrame) -> pd.DataFrame:
    device_accounts = (
        accounts.groupby("device_id")["account_id"]
        .apply(list)
        .reset_index()
    )
    device_accounts.columns = ["device_id", "account_ids"]
    return device_accounts


def _generate_ips_table(accounts: pd.DataFrame) -> pd.DataFrame:
    ip_accounts = (
        accounts.groupby("ip_address")["account_id"]
        .apply(list)
        .reset_index()
    )
    ip_accounts.columns = ["ip_address", "account_ids"]
    return ip_accounts


def _build_ground_truth(accounts: pd.DataFrame, ring_metas: list[dict]) -> dict:
    rings = []
    for meta in ring_metas:
        members = accounts[accounts["ring_id"] == meta["ring_id"]]["account_id"].tolist()
        rings.append({
            "ring_id": meta["ring_id"],
            "size": meta["size"],
            "shared_device": meta["shared_device"],
            "shared_ip": meta["shared_ip"],
            "burst_start": meta["burst_start"],
            "burst_end": meta["burst_end"],
            "member_account_ids": members,
        })
    normal_ids = accounts[~accounts["is_ring"]]["account_id"].tolist()
    return {
        "total_accounts": len(accounts),
        "num_rings": len(ring_metas),
        "rings": rings,
        "normal_account_ids": normal_ids,
    }


def generate(output_dir: str = None):
    if output_dir is None:
        output_dir = str(Path(__file__).parent.parent / "raw_hard")
    labels_dir = str(Path(__file__).parent.parent / "labels")

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    print(f"Generating HARD dataset: {TOTAL_ACCOUNTS} accounts with {NUM_RINGS} hard rings...")
    print(f"  Burst window: {HARD_BURST_MINUTES_MIN}-{HARD_BURST_MINUTES_MAX} minutes")
    print(f"  Device overlap: {HARD_SHARED_DEVICE_PROB:.0%}")
    print(f"  IP overlap: {HARD_SHARED_IP_PROB:.0%}")
    print(f"  Referral density: {HARD_REFERRAL_DENSITY:.0%} (NO cycle)")

    normal_count = TOTAL_ACCOUNTS
    ring_metas = []
    ring_dfs = []

    seq = 1
    for ring_id in range(1, NUM_RINGS + 1):
        ring_df, meta = _generate_hard_ring(seq, ring_id)
        ring_dfs.append(ring_df)
        ring_metas.append(meta)
        seq += meta["size"]
        normal_count -= meta["size"]

    ring_accounts = pd.concat(ring_dfs, ignore_index=True)
    normal_accounts = _generate_normal_accounts(normal_count)

    accounts = pd.concat([normal_accounts, ring_accounts], ignore_index=True)
    accounts = accounts.sort_values("signup_time").reset_index(drop=True)

    for i in range(len(accounts)):
        accounts.at[i, "account_id"] = _id(ACCOUNT_PREFIX, i + 1)

    accounts = _assign_devices(accounts)
    accounts = _assign_ips(accounts)

    payment_methods = _generate_payment_methods(accounts)
    transactions = _generate_transactions(accounts)
    referrals = _generate_referrals(accounts, ring_metas)

    devices_table = _generate_devices_table(accounts)
    ips_table = _generate_ips_table(accounts)

    ground_truth = _build_ground_truth(accounts, ring_metas)

    # Capture stats before dropping internal columns
    normal_count_final = int(accounts[~accounts["is_ring"]].shape[0])
    ring_count_final = int(accounts[accounts["is_ring"]].shape[0])

    accounts = accounts.drop(
        columns=["is_ring", "ring_id", "_shared_device", "_shared_ip"],
        errors="ignore",
    )

    accounts.to_csv(os.path.join(output_dir, "accounts.csv"), index=False)
    devices_table.to_csv(os.path.join(output_dir, "devices.csv"), index=False)
    ips_table.to_csv(os.path.join(output_dir, "ips.csv"), index=False)
    payment_methods.to_csv(os.path.join(output_dir, "payment_methods.csv"), index=False)
    transactions.to_csv(os.path.join(output_dir, "transactions.csv"), index=False)
    referrals.to_csv(os.path.join(output_dir, "referrals.csv"), index=False)

    with open(os.path.join(labels_dir, "ground_truth_hard.json"), "w") as f:
        json.dump(ground_truth, f, indent=2)

    print(f"\nGenerated {len(accounts)} accounts:")
    print(f"  Normal: {normal_count_final}")
    print(f"  Ring accounts: {ring_count_final}")
    for meta in ring_metas:
        print(f"    Ring {meta['ring_id']}: {meta['size']} accounts, "
              f"burst {meta['burst_start']} -> {meta['burst_end']}")
    print(f"\nFiles written to: {output_dir}/")
    print(f"Ground truth written to: {labels_dir}/ground_truth_hard.json")


if __name__ == "__main__":
    output = sys.argv[1] if len(sys.argv) > 1 else None
    generate(output)
