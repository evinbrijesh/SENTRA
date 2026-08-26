"""
Sentra — Synthetic Dataset Generator

Generates ~500 accounts with 2–3 injected fraud rings.
Outputs CSVs to data/raw/ and labels to data/labels/ground_truth.json.

Run: python -m data.generator.generate
  or: python data/generator/generate.py
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

from data.generator.config import (
    ACCOUNT_PREFIX,
    DEVICE_PREFIX,
    IP_PREFIX,
    TXN_PREFIX,
    NORMAL_KYC_WEIGHTS,
    NORMAL_REFERRAL_PROB,
    NORMAL_TXN_MAX,
    NORMAL_TXN_MIN,
    NUM_RINGS,
    RING_BURST_MINUTES_MAX,
    RING_BURST_MINUTES_MIN,
    RING_KYC_WEIGHTS,
    RING_REFERRAL_DENSITY,
    RING_SHARED_DEVICE_PROB,
    RING_SHARED_IP_PROB,
    RING_SIZE_MAX,
    RING_SIZE_MIN,
    RING_TXN_MAX,
    RING_TXN_MIN,
    SEED,
    TIME_END,
    TIME_START,
    TOTAL_ACCOUNTS,
    UPI_PROBABILITY,
)

fake = Faker()
Faker.seed(SEED)
random.seed(SEED)
np.random.seed(SEED)

TIME_START_DT = datetime.strptime(TIME_START, "%Y-%m-%d %H:%M:%S")
TIME_END_DT = datetime.strptime(TIME_END, "%Y-%m-%d %H:%M:%S")
TOTAL_DAYS = (TIME_END_DT - TIME_START_DT).days


def _id(prefix: str, seq: int) -> str:
    return f"{prefix}-{seq:04d}"


def _random_ip() -> str:
    """Generate a realistic-looking IPv4 address (not reserved ranges)."""
    while True:
        octets = [random.randint(1, 223) for _ in range(4)]
        if octets[0] == 10:
            continue  # skip private
        return ".".join(str(o) for o in octets)


def _random_upi() -> str:
    name = fake.user_name()[:12]
    bank = random.choice([
        "okhdfcbank", "okicicibank", "okaxisbank", "oksbi",
        "paytm", "okgoogle", "ybl", "ibl",
    ])
    return f"{name}@{bank}"


def _random_card() -> str:
    """Masked card: first 6 + last 4, middle starred."""
    prefix = random.choice(["411122", "523456", "371234", "601100"])
    suffix = f"{random.randint(1000, 9999)}"
    return f"{prefix}******{suffix}"


def _kyc_status(weights: dict) -> str:
    return random.choices(
        list(weights.keys()), weights=list(weights.values()), k=1
    )[0]


def _random_datetime(start: datetime, end: datetime) -> datetime:
    delta = end - start
    random_seconds = random.randint(0, int(delta.total_seconds()))
    return start + timedelta(seconds=random_seconds)


def _generate_normal_accounts(count: int) -> pd.DataFrame:
    """Generate normal accounts with organic signup spread."""
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


def _generate_ring_accounts(start_seq: int, ring_id: int) -> tuple[pd.DataFrame, dict]:
    """Generate a single fraud ring: clustered signups, shared device/IP."""
    size = random.randint(RING_SIZE_MIN, RING_SIZE_MAX)
    burst_minutes = random.randint(RING_BURST_MINUTES_MIN, RING_BURST_MINUTES_MAX)

    # Ring signup burst: random start within 90-day window, all within burst_minutes
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

        # Most share device, some have own
        has_shared_device = random.random() < RING_SHARED_DEVICE_PROB
        # Most share IP, some have own
        has_shared_ip = random.random() < RING_SHARED_IP_PROB

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


def _assign_devices(accounts: pd.DataFrame, normal_count: int) -> pd.DataFrame:
    """Assign device IDs. Ring accounts get shared devices from ring meta."""
    device_ids = []
    device_pool = [_id(DEVICE_PREFIX, i) for i in range(1, 500)]

    # Assign devices to normal accounts first
    for i, row in accounts.iterrows():
        if row["is_ring"]:
            device_ids.append(row.get("_shared_device") or random.choice(device_pool))
        else:
            device_ids.append(_id(DEVICE_PREFIX, i + 1))

    accounts["device_id"] = device_ids

    # Introduce legitimate device overlap among normal accounts
    normal_indices = accounts[~accounts["is_ring"]].index
    num_overlap = int(len(normal_indices) * 0.05)
    overlap_indices = random.sample(list(normal_indices), min(num_overlap, len(normal_indices)))
    shared_normal_device = _id(DEVICE_PREFIX, random.randint(1, 499))
    for idx in overlap_indices:
        accounts.at[idx, "device_id"] = shared_normal_device

    return accounts


def _assign_ips(accounts: pd.DataFrame) -> pd.DataFrame:
    """Assign IP addresses. Ring accounts get shared IPs from ring meta."""
    ip_ids = []

    for i, row in accounts.iterrows():
        if row["is_ring"]:
            ip_ids.append(row.get("_shared_ip") or _random_ip())
        else:
            ip_ids.append(_random_ip())

    accounts["ip_address"] = ip_ids

    # Introduce legitimate IP overlap among normal accounts (shared wifi)
    normal_indices = accounts[~accounts["is_ring"]].index
    num_overlap = int(len(normal_indices) * 0.06)
    overlap_indices = random.sample(list(normal_indices), min(num_overlap, len(normal_indices)))
    shared_normal_ip = _random_ip()
    for idx in overlap_indices:
        accounts.at[idx, "ip_address"] = shared_normal_ip

    return accounts


def _generate_payment_methods(accounts: pd.DataFrame) -> pd.DataFrame:
    """Generate payment methods: ~70% UPI, ~30% masked cards."""
    methods = []
    for _, row in accounts.iterrows():
        if random.random() < UPI_PROBABILITY:
            handle = _random_upi()
            methods.append({
                "account_id": row["account_id"],
                "payment_method_type": "UPI",
                "payment_method_id": handle,
            })
        else:
            card = _random_card()
            methods.append({
                "account_id": row["account_id"],
                "payment_method_type": "CARD",
                "payment_method_id": card,
            })
    return pd.DataFrame(methods)


def _generate_transactions(accounts: pd.DataFrame) -> pd.DataFrame:
    """Each account makes exactly one transaction."""
    txns = []
    for i, row in accounts.iterrows():
        if row["is_ring"]:
            amount = round(random.uniform(RING_TXN_MIN, RING_TXN_MAX), 2)
        else:
            amount = round(random.uniform(NORMAL_TXN_MIN, NORMAL_TXN_MAX), 2)

        signup = datetime.strptime(row["signup_time"], "%Y-%m-%d %H:%M:%S")
        txn_time = signup + timedelta(hours=random.randint(1, 48))

        txns.append({
            "transaction_id": _id(TXN_PREFIX, i + 1),
            "account_id": row["account_id"],
            "amount": amount,
            "timestamp": txn_time.strftime("%Y-%m-%d %H:%M:%S"),
        })
    return pd.DataFrame(txns)


def _generate_referrals(
    accounts: pd.DataFrame, ring_metas: list[dict]
) -> pd.DataFrame:
    """Generate referral edges. Normal: sparse, acyclic. Rings: dense, cyclic."""
    referrals = []
    all_normal = accounts[~accounts["is_ring"]].to_dict("records")
    all_accounts = accounts.to_dict("records")
    account_map = {a["account_id"]: a for a in all_accounts}

    # Normal referrals: sparse, no cycles
    referred_set = set()
    for acc in all_normal:
        if random.random() < NORMAL_REFERRAL_PROB:
            # Pick a referrer who signed up earlier
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

    # Ring referrals: dense, closed-loop
    for meta in ring_metas:
        ring_accounts = [
            a for a in all_accounts if a.get("ring_id") == meta["ring_id"]
        ]
        ring_ids = [a["account_id"] for a in ring_accounts]

        # Create a cycle through all ring accounts (guarantees closure)
        for j in range(len(ring_ids)):
            referrals.append({
                "referrer_id": ring_ids[j],
                "referred_id": ring_ids[(j + 1) % len(ring_ids)],
                "is_ring_referral": True,
                "ring_id": meta["ring_id"],
            })

        # Add extra random referral edges for density
        for j in range(len(ring_ids)):
            for k in range(j + 2, len(ring_ids)):
                if random.random() < RING_REFERRAL_DENSITY:
                    referrals.append({
                        "referrer_id": ring_ids[j],
                        "referred_id": ring_ids[k],
                        "is_ring_referral": True,
                        "ring_id": meta["ring_id"],
                    })

    return pd.DataFrame(referrals)


def _generate_devices_table(accounts: pd.DataFrame) -> pd.DataFrame:
    """Devices table: each unique device_id with at least one account."""
    device_accounts = (
        accounts.groupby("device_id")["account_id"]
        .apply(list)
        .reset_index()
    )
    device_accounts.columns = ["device_id", "account_ids"]
    return device_accounts


def _generate_ips_table(accounts: pd.DataFrame) -> pd.DataFrame:
    """IPs table: each unique ip_address with at least one account."""
    ip_accounts = (
        accounts.groupby("ip_address")["account_id"]
        .apply(list)
        .reset_index()
    )
    ip_accounts.columns = ["ip_address", "account_ids"]
    return ip_accounts


def _build_ground_truth(
    accounts: pd.DataFrame, ring_metas: list[dict]
) -> dict:
    """Build ground truth JSON with ring membership labels."""
    rings = []
    for meta in ring_metas:
        members = accounts[accounts["ring_id"] == meta["ring_id"]][
            "account_id"
        ].tolist()
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
    """Main generation entry point."""
    if output_dir is None:
        output_dir = str(Path(__file__).parent.parent / "raw")
    labels_dir = str(Path(__file__).parent.parent / "labels")

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    print(f"Generating {TOTAL_ACCOUNTS} accounts with {NUM_RINGS} rings...")

    # 1. Generate normal accounts
    normal_count = TOTAL_ACCOUNTS  # will shrink as we allocate ring accounts
    ring_metas = []
    ring_dfs = []

    # Pre-generate rings to know how many normal accounts we need
    seq = 1
    for ring_id in range(1, NUM_RINGS + 1):
        # Estimate ring size to calculate remaining normal accounts
        est_ring_size = (RING_SIZE_MIN + RING_SIZE_MAX) // 2
        ring_df, meta = _generate_ring_accounts(seq, ring_id)
        ring_dfs.append(ring_df)
        ring_metas.append(meta)
        seq += meta["size"]
        normal_count -= meta["size"]

    ring_accounts = pd.concat(ring_dfs, ignore_index=True)
    normal_accounts = _generate_normal_accounts(normal_count)

    # Combine
    accounts = pd.concat([normal_accounts, ring_accounts], ignore_index=True)
    accounts = accounts.sort_values("signup_time").reset_index(drop=True)

    # Reassign sequential IDs after sorting
    for i in range(len(accounts)):
        accounts.at[i, "account_id"] = _id(ACCOUNT_PREFIX, i + 1)

    # Update ring member lists with new IDs
    # Build mapping from old to new
    old_to_new = {}
    for _, row in accounts.iterrows():
        old_to_new[row["_old_id"] if "_old_id" in row.index else row["account_id"]] = row["account_id"]

    # 2. Assign devices and IPs
    accounts = _assign_devices(accounts, normal_count)
    accounts = _assign_ips(accounts)

    # 3. Generate payment methods, transactions, referrals
    payment_methods = _generate_payment_methods(accounts)
    transactions = _generate_transactions(accounts)
    referrals = _generate_referrals(accounts, ring_metas)

    # 4. Generate device/IP lookup tables
    devices_table = _generate_devices_table(accounts)
    ips_table = _generate_ips_table(accounts)

    # 5. Clean up internal columns
    accounts = accounts.drop(columns=["_shared_device", "_shared_ip"], errors="ignore")

    # 6. Write CSVs
    accounts.to_csv(os.path.join(output_dir, "accounts.csv"), index=False)
    devices_table.to_csv(os.path.join(output_dir, "devices.csv"), index=False)
    ips_table.to_csv(os.path.join(output_dir, "ips.csv"), index=False)
    payment_methods.to_csv(os.path.join(output_dir, "payment_methods.csv"), index=False)
    transactions.to_csv(os.path.join(output_dir, "transactions.csv"), index=False)
    referrals.to_csv(os.path.join(output_dir, "referrals.csv"), index=False)

    # 7. Write ground truth
    ground_truth = _build_ground_truth(accounts, ring_metas)
    with open(os.path.join(labels_dir, "ground_truth.json"), "w") as f:
        json.dump(ground_truth, f, indent=2)

    # 8. Print summary
    print(f"\nGenerated {len(accounts)} accounts:")
    print(f"  Normal: {len(accounts[~accounts['is_ring']])}")
    print(f"  Ring accounts: {len(accounts[accounts['is_ring']])}")
    print(f"  Rings: {NUM_RINGS}")
    for meta in ring_metas:
        print(f"    Ring {meta['ring_id']}: {meta['size']} accounts, "
              f"burst {meta['burst_start']} → {meta['burst_end']}")
    print(f"\nTransactions: {len(transactions)}")
    print(f"Referrals: {len(referrals)}")
    print(f"  Normal: {len(referrals[~referrals['is_ring_referral']])}")
    print(f"  Ring: {len(referrals[referrals['is_ring_referral']])}")
    print(f"\nPayment methods: {len(payment_methods)}")
    print(f"  UPI: {len(payment_methods[payment_methods['payment_method_type'] == 'UPI'])}")
    print(f"  CARD: {len(payment_methods[payment_methods['payment_method_type'] == 'CARD'])}")
    print(f"\nFiles written to: {output_dir}/")
    print(f"Ground truth written to: {labels_dir}/ground_truth.json")


if __name__ == "__main__":
    output = sys.argv[1] if len(sys.argv) > 1 else None
    generate(output)
