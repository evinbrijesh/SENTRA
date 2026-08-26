"""
Sentra — Synthetic Dataset Generator Configuration

All tunable parameters in one place. Adjust these to iterate on
ring realism ("detectable but not too obvious") without touching
generation logic.
"""

# ── Dataset scale ──────────────────────────────────────────────
TOTAL_ACCOUNTS = 500
NUM_RINGS = 3                  # number of injected fraud rings
RING_SIZE_MIN = 10             # min accounts per ring
RING_SIZE_MAX = 30             # max accounts per ring

# ── Time window ────────────────────────────────────────────────
# Overall signup range: 90 days
TIME_START = "2025-01-01 00:00:00"
TIME_END = "2025-03-31 23:59:59"

# Ring burst window: all signups within 15–120 minutes
RING_BURST_MINUTES_MIN = 15
RING_BURST_MINUTES_MAX = 120

# ── ID prefixes ────────────────────────────────────────────────
ACCOUNT_PREFIX = "ACC"
DEVICE_PREFIX = "DEV"
IP_PREFIX = "IP"
TXN_PREFIX = "TXN"

# ── KYC status ────────────────────────────────────────────────
# Normal accounts: 85% VERIFIED, 10% PENDING, 5% REJECTED
NORMAL_KYC_WEIGHTS = {"VERIFIED": 0.85, "PENDING": 0.10, "REJECTED": 0.05}

# Ring accounts: mostly PENDING (throwaway mule accounts)
RING_KYC_WEIGHTS = {"VERIFIED": 0.15, "PENDING": 0.70, "REJECTED": 0.15}

# ── Transactions ──────────────────────────────────────────────
# Normal: ₹50 – ₹10,000 (log-normal-ish spread)
NORMAL_TXN_MIN = 50
NORMAL_TXN_MAX = 10_000

# Ring: ₹10 – ₹200 (minimum eligibility for referral payout)
RING_TXN_MIN = 10
RING_TXN_MAX = 200

# ── Device / IP sharing (normal accounts) ─────────────────────
# Fraction of normal accounts that share a device with ≥1 other account
# (simulates shared wifi, family devices — legitimate overlap)
NORMAL_DEVICE_SHARING_PROB = 0.08

# Fraction of normal accounts that share an IP with ≥1 other account
NORMAL_IP_SHARING_PROB = 0.10

# ── Referral chains (normal accounts) ─────────────────────────
# Probability that a normal account was referred by another normal account
NORMAL_REFERRAL_PROB = 0.15

# ── Ring structure ─────────────────────────────────────────────
# Fraction of ring accounts sharing the same device (high — core signal)
RING_SHARED_DEVICE_PROB = 0.80

# Fraction of ring accounts sharing the same IP
RING_SHARED_IP_PROB = 0.75

# Referral density within ring: probability that any two ring accounts
# are connected by a referral edge (creates dense closed-loop chain)
RING_REFERRAL_DENSITY = 0.30

# ── Payment methods ───────────────────────────────────────────
# ~70% UPI, ~30% masked cards
UPI_PROBABILITY = 0.70

# ── Random seed ────────────────────────────────────────────────
SEED = 42
