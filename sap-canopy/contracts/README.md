# S.A.P. contracts — AgentPay + TreeNFT

**On-chain escrow where 1% of every agent job funds a real tree.**

Part of the [S.A.P. (Shaddai Asimov Project)](https://github.com/IzzoSol/shaddai-asimov-project)
green-initiative stack: a local-first urban-forest digital twin plus a
transparent payments leg that routes a slice of every payment to actual
planting and verification work.

> *Illustrative averages, not site-specific predictions.*

---

## What these contracts do

1. A **poster** escrows a stablecoin bounty (`postJob`).
2. An **agent** does the work.
3. The **poster** names the winner (`completeJob`).
4. The winner is paid **99%** and a **TreeNFT** claim is minted to them.
5. The remaining **1%** is booked into the tree fund and released to the
   designated tree-fund recipient by an **authorised settler**.

The contracts **never trade, never bridge**, and expose no route that moves
escrowed user funds to an arbitrary address.

---

## The five spec flaws — and a sixth

The original `AGENTPAY_MULTICHAIN_SPEC.md` sketch was **not safe to deploy**.
It carried five individually exploitable defects plus a compile error against
current OpenZeppelin. A **sixth** defect was found during implementation, when
the first behavioural test run was attempted.

Every fix is called out inline in the source, at the exact site that implements
it, and every one is pinned by a named assertion in the test suite.

| # | The defect | The fix |
|---|-----------|---------|
| **1** | `uint8 public chainId = 8453` — `uint8` maxes out at **255**, so Base's 8453 could not be represented. It was also hardcoded, so Polygon would report Base's id. | `uint256 public immutable chainId = block.chainid` — read from the chain, full width, nothing hardcoded. |
| **2** | ERC20 `transfer` return values were discarded. **USDT returns no data at all**, and a `false` return was swallowed — so a job could be marked **completed while the winner received nothing**. | OpenZeppelin `SafeERC20`. The suite deploys a no-return token (must succeed and pay) and a lying `false`-returning token (must revert, job stays open). |
| **3** | The 1% tree fund was "transferred" to the contract itself — a no-op. The money never moved, was never booked, and could never be claimed. **The accounting was a lie.** | An explicit `treeFundAccrued` ledger plus `releaseTreeFund()`, callable only by the authorised settler and only to the designated recipient. |
| **4** | `postJob` recorded the **requested** bounty, but `transferFrom` may deliver less. The contract would then be insolvent and strand the poster's funds. | Measure the **actual** received amount with a balance-before/after delta and record that. A 3% fee token posting 100000 records **97000**. |
| **5** | Only the poster could complete a job — no cancel, no timeout, no expiry refund, no zero-address check. Bounties could be **locked forever** or paid to `address(0)` and burned. | `cancelJob`, `expireJob` (callable by **anyone** after the deadline), a 30-day TTL, a zero-address check, a 1024-byte prompt bound, and `nonReentrant` everywhere. |
| **6** | **`jobCounter` started at 0, so the first job got id 0** — but 0 is the "no such job" sentinel every lookup tests against, and TreeNFT rejects `jobId == 0` outright. Job 0 could be posted and then **never read, completed, cancelled, extended or expired**. Its bounty was locked forever, and `expireJob` — the flaw-5 fix that exists to prevent exactly that — was unreachable for the first job. | Job ids start at `FIRST_JOB_ID` (1). Zero is reserved permanently as the sentinel. `FIRST_JOB_ID` is a public constant so the invariant is assertable from outside. |

**Secondary fixes:** the OpenZeppelin v5 `ReentrancyGuard` import path (the
sketch's path was removed in v5, so it did not even compile), the v5 `Ownable`
constructor form, token-id collisions (the spec derived the id from
`uint160(to)`, so one address winning two jobs silently overwrote the first
record), and local variable shadowing of the `job()` view.

---

## Running it

```bash
cd sap-canopy/contracts
npm install          # @openzeppelin/contracts 5.1.0, solc 0.8.24, ethers 6, ganache 7
npm run build        # -> node scripts/compile.js   (solc build gate)
npm run check:foundry # -> node scripts/check-foundry.js (type-check the Forge suites)
npm test             # -> node scripts/test.js      (ganache + ethers behavioural suite)
```

### `npm run build` — the compile gate

`scripts/compile.js` compiles both contracts with **solc 0.8.24** (optimizer
200, `evmVersion: cancun`) and **fails on any error *or* warning**. It then
asserts the ABI surface the backend and the documentation depend on:
every required function, every required event, the custom errors, that
`chainId` is `uint256` and not `uint8` (flaw 1), and that `FIRST_JOB_ID` is
exposed and the constructor initialises the counter to it (flaw 6).

It writes `build/contracts.json` — ABI plus creation and deployed bytecode for
both contracts — which is what a deployment script reads.

### `npm test` — the behavioural suite

`scripts/test.js` compiles the contracts **and the mocks** in `test/mocks/`,
deploys them to a local ganache chain, and asserts every flaw fix end-to-end
against real deployed bytecode. Each assertion is named after the defect it
pins down, so a failure reads as a regression against a known defect rather
than a mystery.

The mocks in `test/mocks/Mocks.sol` are deliberately hostile:

| Mock | What it models |
|------|----------------|
| `MockERC20` | A well-behaved ERC20. |
| `NoReturnToken` | **USDT**: `transfer` and `transferFrom` return *nothing*. |
| `FalseReturnToken` | A token that transfers the funds and then **lies**, returning `false`. |
| `FeeOnTransferToken` | A 3% transfer-fee token — the same shape as `$ASIMOV`'s Token-2022 transfer fee. |

### `npm run test:foundry` — the equivalent Foundry suite

`test/AgentPay.t.sol` and `test/TreeNFT.t.sol` are the same assertions written
for Forge — **42 test functions**. **Foundry is not installed on this machine**
(`forge` / `anvil` are absent), so the ganache suite is the one that actually
runs today. To run the Forge suites:

```bash
forge install foundry-rs/forge-std --no-commit
forge test -vvv
```

`forge-std` must be vendored; `lib/`, `out/` and `cache/` are git-ignored so
it never lands in the repository.

### `npm run check:foundry` — proving the Forge suites compile

Shipping Solidity that has never been compiled is how broken tests get
committed. `scripts/check-foundry.js` compiles both `.t.sol` files with the
**same solc 0.8.24** that builds the production contracts, against a local
stub of `forge-std` (`test/forge-std-stub/Test.sol`), so syntax errors, type
errors and ABI mismatches are caught here even though Forge cannot run.

It is **not** a test runner — it proves the Forge code compiles. The
assertions execute in `scripts/test.js`.

---

## Deployment targets

| Network | RPC | Stablecoin | Status |
|---------|-----|-----------|--------|
| **Base** | `base.blockscout.com` | fxUSD | Primary target |
| **Polygon** | `polygon-rpc.com` | USDT | Secondary — note USDT's no-return `transfer`, which is exactly flaw 2 |
| **Solana** | `api.mainnet-beta.solana.com` | USDC | **Not written.** An Anchor/Rust program with two defects of its own. See below. |

### Deployment checklist

- [ ] `npm install && npm run build && npm test`
- [ ] Confirm `build/contracts.json` exists for both contracts
- [ ] Decide the stablecoin address **per chain**
- [ ] Decide the **tree-fund recipient** — the Treegens treasury wallet.
      *Not yet configured*: `TREEGENS_TREASURY_WALLET` is unset, so tree
      intents currently queue with `destination: null`.
- [ ] Deploy `TreeNFT` first (the verifier address goes in the constructor)
- [ ] Deploy `AgentPay` with the token address and the tree-fund recipient
- [ ] `setTreeNFT(treeNFT.address)` on AgentPay
- [ ] `setMinter(agentPay.address)` on TreeNFT
- [ ] `setSettler(<human-reviewed settler>)` on AgentPay
- [ ] Post a 1-unit test job; confirm 99% paid, 1% accrued, one TreeNFT minted
- [ ] Confirm `treeFundAccrued()` moved and `treeFundReleased()` did not

**Gas** — *illustrative averages, not site-specific predictions.* Creation code
is **AgentPay ≈ 7.5 KB** and **TreeNFT ≈ 9.8 KB** (optimizer 200, cancun).
Deployment gas is dominated by code deposit and varies by chain and by current
schedule — **measure it on a fork before quoting a number.**

---

## The Solana / Anchor leg — not written

The sketch included an Anchor/Rust program for Solana. **It has two defects of
its own and is not implemented here:**

1. **`complete_job` has no poster-authority check.** The poster is the only
   party who may name the winner, but the sketch's `complete_job` does not
   verify that the signer is the job's poster. Anyone could claim the bounty.
2. **Its `tree_fund` is never actioned.** The 1% is accounted for but no
   instruction ever moves it, so it sits inert — the same lie as flaw 3.

Both are the same class of defect as the Solidity flaws and must be fixed
before any Solana deployment. The EVM contracts are the shipped, tested
implementation; the Solana leg is a **future sub-project with its own gate.**

---

## The tree-fund framing

The 1% tree fund is **payment for planting and verification services already
rendered** — not an investment, not a promise of appreciation, and not
redeemable for fiat. This is a **services** payment, and it is what keeps the
leg clear of a Howey-style analysis.

**Settlement is human-reviewed.** There is no route that settles the tree fund
on anyone's behalf except the authorised settler calling `releaseTreeFund` —
a deliberate design choice, not an omission.

---

## Known limitations

- **Fee-on-transfer dust.** With a transfer-fee token, a small residual can
  remain in the contract that is not covered by `treeFundAccrued`. It is not
  releasable, because `releaseTreeFund` is deliberately bounded by
  `treeFundAccrued` — loosening that bound would let the settler reach user
  escrow, which is a much worse failure. The deployment targets (fxUSD, USDT,
  USDC) are not fee-on-transfer, so this only appears in the robustness test.
- **No treasury.** The contracts escrow and account. They do not fund
  Treegens, settle on-chain, or route fees into any liquidity pool. The
  treasury that records *settlement intent* lives in the S.A.P. backend
  (`Shaddai-3d` → `backend/services/treasury-service.js`); a human-reviewed
  settler executes it.

---

## Files

| Path | What |
|------|------|
| `src/AgentPay.sol` | The escrow + tree-fund contract. All six fixes documented inline. |
| `src/TreeNFT.sol` | The ERC-721 tree claim, with monotonic token ids and on-chain metadata. |
| `scripts/compile.js` | The solc 0.8.24 build gate — 31 checks, fails on any error or warning. |
| `scripts/test.js` | The ganache + ethers behavioural harness. |
| `test/mocks/Mocks.sol` | `MockERC20`, `NoReturnToken`, `FalseReturnToken`, `FeeOnTransferToken`. |
| `test/AgentPay.t.sol` | The equivalent Foundry suite. |
| `test/TreeNFT.t.sol` | The equivalent Foundry suite. |
| `foundry.toml` | Foundry configuration. |

---

## Licence

MIT.
