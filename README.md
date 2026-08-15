# GrantOS

**Decentralized grant management with AI-verified milestones, on GenLayer.**

GrantOS lets a funder escrow GEN for a grant, break it into sequential milestones, and release funds only when a grantee's submitted evidence is independently verified by AI validators reaching consensus — no central reviewer, no trusted middleman. Where a verdict is borderline, it routes to the funder for a human decision instead of silently moving money.

- **Live app:** https://grant-os-one.vercel.app/
- **Network:** GenLayer Bradbury testnet
- **Contract:** [`0x0ddaFA2CF3d46B1Dab53186cB865AF063F6D0867`](deployments/bradbury.json)

---

## Why it's interesting

Most "on-chain grants" still need a human to eyeball a deliverable and click *release*. GrantOS pushes that judgment on-chain. Each milestone has plain-English success criteria; when the grantee submits a report and evidence links, the contract runs a **non-deterministic AI evaluation under GenLayer's Equivalence Principle** — a leader validator scores the work and independent validators must independently agree before the result is accepted. Funds move automatically only on a confident, high-quality pass. Anything less becomes a *pending review* the funder resolves manually. Nothing is auto-rejected in a way that traps the grantee — they can resubmit.

## How it works

```
Funder                        Contract (GenLayer)                 Grantee
  │  create_grant (escrow GEN)      │                                │
  ├────────────────────────────────►  grant: active, funds escrowed  │
  │                                 │                                │
  │                                 │        submit_milestone         │
  │                                 │◄───────────────────────────────┤
  │                                 │  AI validators evaluate evidence│
  │                                 │  (leader + independent voters)  │
  │                                 │                                │
  │            ┌────────────────────┴────────────────────┐          │
  │       completed                partial          not_completed    │
  │   (auto-release GEN)     (→ pending review)     (resubmit)       │
  │                                 │                                │
  │  resolve_pending_review         │                                │
  ├──── approve → release ─────────►│                                │
  └──── reject ────────────────────►│                                │
```

**Verdict rules (enforced in the contract):**

| Milestone lifecycle | Behavior |
|---|---|
| Milestones are **sequential** | You can't submit milestone *N* until *N−1* is completed. |
| Escrow must be **exact** | Milestone amounts must sum to the grant total exactly, and the funder must send exactly that much GEN — over/underpayment reverts (there is no refund path, so this prevents stuck funds). |
| `completed` | Only when the AI verdict is `completed` **and** confidence is high/medium **and** quality score ≥ 70. Funds release automatically to the grantee. |
| `partial` | Any borderline pass. Funds do **not** move; the milestone is flagged for the funder to `approve` or `reject`. |
| `not_completed` | No funds move; the grantee may fix the work and resubmit. |
| **Consensus** | Validators compare their independent evaluations by *settlement effect* (same payout/review decision, and close quality scores when auto-approving), not by exact wording — so honest disagreement on phrasing doesn't block agreement. |

## For grantees: how to actually prove your work

The AI validators **fetch your evidence URLs and read their contents** against the milestone's success criteria. So evidence quality is everything:

- **Link to directly-fetchable content**, not to pages that only render via JavaScript. A raw source file, a README, a live demo endpoint, a published artifact, or an API response works well. A repo *landing page* that needs a browser to render may come back nearly empty to a fetcher.
- **Make the report specific.** State exactly what was built and where in the evidence it can be seen ("the contract is in `contract/grantos.py`; the deployed address is X; the demo is live at Y").
- **Up to 3 URLs** per submission — use them to cover each criterion. (The contract fetches and reads these inside the AI validators' time-bounded evaluation, so a few strong, directly-fetchable links beat many weak ones.)
- If a verdict comes back `partial` or `not_completed`, read the feedback, strengthen the evidence, and resubmit.

## Architecture

```
GrantOs/
├── contract/
│   ├── grantos.py          # GenLayer Intelligent Contract (Python / py-genlayer)
│   └── test_grantos.py     # Contract tests, run against the real GenVM engine
├── src/
│   ├── App.jsx             # Hash routing: landing page vs. #app (the product)
│   ├── context/
│   │   └── GrantOSContext.jsx   # Wallet connection, client, contract address (shared state)
│   ├── lib/
│   │   └── genlayerClient.js    # Thin wrapper — one function per contract method
│   └── components/
│       ├── LandingPage.jsx + VerificationDiagram.jsx + FeatureIcons.jsx
│       ├── FunderDashboard.jsx   # Create grants, resolve pending reviews
│       ├── GranteeSubmission.jsx # Submit report + evidence for AI verification
│       ├── GrantBrowser.jsx      # Read any grant, progress, and milestone results
│       ├── EvidenceViewer.jsx    # Criteria met/not-met + AI score/feedback
│       ├── Header.jsx, BrandMark.jsx, StatusPill.jsx, Banner.jsx, ErrorBoundary.jsx
├── deployments/
│   └── bradbury.json       # Verified deployment address + evidence tx hashes
└── scripts/
    └── deploy-bradbury.mjs # Deploy/verify the contract on Bradbury
```

**Stack:** React 19 · Vite 8 · vitest 4 · [`genlayer-js`](https://www.npmjs.com/package/genlayer-js) · viem · self-hosted fonts (Fraunces + IBM Plex Sans/Mono via `@fontsource`).

Every UI action goes through `src/lib/genlayerClient.js`, which maps 1:1 onto the contract's public methods. This is also the boundary the frontend tests exercise, so the tests verify the UI drives the contract API correctly, independent of the chain.

### Contract API

| UI action | Client function | Contract method |
|---|---|---|
| Create & fund a grant | `createGrant()` | `create_grant(...)` — **payable** |
| Submit milestone evidence | `submitMilestone()` | `submit_milestone(grant_id, milestone_id, report_text, evidence_urls)` |
| Approve/reject a flagged milestone | `resolvePendingReview()` | `resolve_pending_review(grant_id, milestone_id, approve)` |
| Load a grant | `getGrant()` | `get_grant(grant_id)` |
| Load progress | `getGrantProgress()` | `get_grant_progress(grant_id)` |
| Load a milestone's AI result | `getMilestoneResult()` | `get_milestone_result(grant_id, milestone_id)` |

`fetchGrantBundle()` composes the three read calls into one. Because a write reaches consensus a few seconds *before* a view call can read the new state, the client also exposes `waitForGrantVisible()` and `waitForMilestoneResult()` — the UI polls these so it only reports success once the change is actually readable, and shows the real AI verdict rather than claiming completion prematurely.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm test           # run the frontend test suite (vitest)
npm run build      # production build → dist/
npm run preview    # serve the production build locally
npm run lint       # oxlint
```

### Using the app

1. Open the app and click **Connect Wallet**. GrantOS uses standard injected-wallet methods (MetaMask or compatible) to add/switch to GenLayer Bradbury — MetaMask Snaps are not required. Get testnet GEN from the GenLayer faucet.
2. Confirm the **contract address** in the header is set (see below).
3. **Funder Dashboard** → create a grant (milestone amounts must sum to the total). **Grantee Submission** → submit evidence for the next milestone. **Grant Browser** → inspect any grant and its AI verdicts.

## Deployment

### Frontend (Vercel)

The contract address is read from `VITE_CONTRACT_ADDRESS` at **build time** (Vite inlines env vars into the bundle):

1. In Vercel → **Settings → Environment Variables**, add
   `VITE_CONTRACT_ADDRESS = 0x0ddaFA2CF3d46B1Dab53186cB865AF063F6D0867` for the **Production** environment.
2. **Redeploy** the frontend so the build picks it up.

> Users can also paste the contract address into the header field at runtime, so the app works even without the env var — but setting it makes it the automatic default.

### Contract (GenLayer Bradbury)

The deployed contract is recorded in [`deployments/bradbury.json`](deployments/bradbury.json):

- Contract: `0x0ddaFA2CF3d46B1Dab53186cB865AF063F6D0867`
- Deployment tx: `0xae4f72d6f8f48993fcde8b6e707e05683a4db5539d3ee964bb05351d8b96391a`

To deploy your own instance:

```bash
# Put PRIVATE_KEY and WALLET_ADDRESS in .env.local (gitignored)
npm run preflight:bradbury   # remote schema check before spending GEN
npm run deploy:bradbury      # deploys, then writes the address to
                             # deployments/bradbury.json and .env.local
```

> **Never commit `.env` / `.env.local`** — they hold your private key. They are gitignored in this repo.

## Testing

- **Frontend** (`npm test`): each component and the `genlayerClient` wrapper are tested with the `genlayer-js` client mocked at the `readContract`/`writeContract` boundary — proving the UI sends the correct method names and argument order to the contract, plus routing, error boundaries, wallet gating, and form validation.
- **Contract** (`contract/test_grantos.py`): runs against the real GenVM engine, covering escrow rules, sequential milestones, the quality/confidence gating, pending-review resolution, and storage-key safety.

## License

No license file is currently included. Add one (e.g. MIT) before public release if you intend others to reuse the code.
