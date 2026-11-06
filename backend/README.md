# S.A.P. backend — the payments leg

The transparent-money half of the **Shaddai Asimov Project**: a fee-routing
policy you can read in plain numbers, a treasury report that shows what
actually happened, tree payments for real planting, Hyperliquid market
reads, and a HIP-1/HIP-2 deployment planner.

> **Nothing here trades, signs, or moves money on its own.**
> Every route either READS a chain or RECORDS an intent. Settlement is
> executed by a separate, human-reviewed settler that does not exist in this
> repository.

---

## Run it locally (free, offline-capable, no keys)

```bash
cd backend
npm install
npm start          # http://127.0.0.1:3000
```

Then:

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/sap/health
curl http://127.0.0.1:3000/api/sap/policy
curl http://127.0.0.1:3000/api/sap/hip1/plan
```

`npm test` runs the two SAP suites (65 assertions). They need no network,
no database, and no secrets.

---

## The policy, in plain numbers

Every fee is split **40 / 40 / 20**, in basis points, summing to exactly
10000:

| Slice | Bps | Where it goes |
|---|---|---|
| `treeFund` | 4000 | Treegens planting + verification |
| `asimovLiquidity` | 4000 | $ASIMOV liquidity (Solana) |
| `platform` | 2000 | Platform upkeep |

The policy is owned by `services/treegens-service.js` (`splitByPolicy` /
`readPolicyFromEnv`). **Do not copy those constants into another module** —
import them. The reason is in the next section.

---

## The two rules that matter most

### 1. Credits are not money

The x402 fee is denominated in **SHAD-Credits** — a closed-loop soft
currency. Credits live in their own collection (`db.creditFeeAllocations`)
with their own unit scale (`CREDIT_UNIT_SCALE = 100`).

**They must never enter the USD-denominated ledger.** The treasury service
keeps two books:

- `db.settlements` — real money, in cents.
- `db.creditFeeAllocations` — credits, in credit units.

Mixing them is the single easiest way to corrupt the transparency report.
If you touch `services/treasury-service.js`, keep the two apart.

### 2. No HTTP route may trade

Trading lives behind `lib/hyperliquid.js`'s **four-key gate**:

1. `HYPERLIQUID_TRADING_ENABLED=true`
2. `HYPERLIQUID_SDK` present
3. `HYPERLIQUID_PRIVATE_KEY` set
4. `HYPERLIQUID_ACCOUNT_ADDRESS` set

The public surface never sets these, and no route calls `placeOrder` /
`placeSpotOrder`. The treasury records **settlement intent only** — a
human-reviewed settler executes it.

---

## Route map

| Method | Path | What it does |
|---|---|---|
| GET | `/api/sap/health` | stack status, market counts, trading-gate state |
| GET | `/api/sap/policy` | the 40/40/20 split, live |
| GET | `/api/sap/policy/preview` | what a given fee would be split into |
| GET | `/api/sap/treasury/report` | transparency report, in cents |
| GET | `/api/sap/treasury/pools` | pool balances |
| GET | `/api/sap/treegens/plots` | the tree plots available to fund |
| POST | `/api/sap/treegens/pay` | pay for a planting service |
| GET | `/api/sap/treegens/payments` | payment receipts |
| GET | `/api/sap/hyperliquid/markets` | perp market universe |
| GET | `/api/sap/hyperliquid/spot` | spot tokens + prices |
| GET | `/api/sap/hyperliquid/account/:address` | account snapshot |
| GET | `/api/sap/hyperliquid/fees/:address` | fee tier |
| GET | `/api/sap/hip1/plan` | HIP-1 + HIP-2 deployment plan (**never signs**) |
| GET | `/api/sap/hip1/auction` | live Dutch-auction status |
| GET | `/api/x402/balance` | credit balance |
| GET | `/api/x402/txns` | credit ledger |
| POST | `/api/x402/charge` | a credit charge |
| POST | `/api/x402/pause` | admin: pause the ledger |
| POST | `/api/x402/grant` | admin: grant credits |

---

## The HIP-1 planner, and the invariant it protects

`lib/hip1-deploy.js` enforces one hard rule:

```
maxSupplyWei === total(user-genesis allocation)
```

**Do not relax it.** It is a safety invariant, not a stylistic choice.

The route's defaults are reconciled to it in `sap-routes.js`:

- `maxSupplyWei` and the genesis allocation are **two views of one number**.
  Whichever the caller states is authoritative; the other is derived from
  it. Stating both with *different* values is a genuine conflict and still
  returns `400 HIP1_SUPPLY_MISMATCH`.
- The genesis **address** defaults to HIP-1's own documented "simplest
  setup" — *"the deployer can put the max supply … in the system address"* —
  using the next free Core spot token index, flagged as **provisional**
  because the index is only assigned when step 1 (`registerToken2`) lands.
- `?genesisAddress=` always wins over the default.

The planner never signs and never broadcasts. It is a preview.

---

## Layout

```
backend/
├── server.js                 minimal standalone host
├── sap-routes.js             the S.A.P. HTTP surface
├── x402-routes.js            the x402 credit surface
├── x402-security.js          pause / replay / budgets / PII-safe logging
├── services/
│   ├── treasury-service.js   real-money ledger (cents) + credit ledger
│   ├── treegens-service.js   OWNER of splitByPolicy / readPolicyFromEnv
│   └── reputation-service.js
├── lib/
│   ├── hip1-deploy.js        HIP-1/2 planner + the supply invariant
│   ├── hyperliquid.js        chain reads + the four-key trading gate
│   ├── json-store.js         atomic JSON persistence
│   └── economy-x402-bridge.js
├── middleware/did-resolver.js
├── tests/                    65 assertions, no network, no secrets
└── data/                     seeds: static plot catalogue + empty ledgers
```

`auth-guard.js`, `auth-service.js` and `economy-service.js` are the shared
SHADDAI modules these routes depend on. They are included so the payments
leg runs standalone. In the production app they are mounted into a larger
server.

---

## Known limits

- **Settlement is intent-only.** Nothing in this repo executes a payout.
- `TREEGENS_TREASURY_WALLET` unset ⇒ tree intents queue with
  `destination: null` and are not sent anywhere.
- The `$ASIMOV` liquidity leg points at a Raydium LaunchLab **bonding
  curve**. "Deepening liquidity" there means executing a **buy**, venue fees
  go to the platform, and graduation migrates the pool to a **new address**.
  Buying our own token with user fees is wash-trade-shaped, which is exactly
  why this repo records intent instead of trading.
- Hyperliquid **geoblocks US residents**, and token-linked rewards attract
  Howey analysis. Both are compliance gates, not engineering details.
- All figures carry the caveat: *illustrative averages, not site-specific
  predictions.*

See [`../docs/SAP_TREASURY.md`](../docs/SAP_TREASURY.md) for the full
treasury document.
