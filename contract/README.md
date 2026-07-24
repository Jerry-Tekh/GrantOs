# GrantOS Intelligent Contract

This is the GenLayer Intelligent Contract that the React app (one level up) talks to.

- `grantos.py` — the contract itself
- `test_grantos.py` — 57 tests, run for real against the GenVM engine (`gltest.direct`)
- `../scripts/deploy-bradbury.mjs` — validates, deploys, and verifies the contract on Bradbury

## Bradbury compatibility

The first line pins the production GenVM runner required by the official
GenLayer contract skill:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

Do not change this to `latest` or `test`; those aliases are for local
development and are rejected by GenLayer networks.

The deployment script asks Bradbury to generate the schema before submitting
a transaction. It then verifies the finalized execution result, deployed
source, and six-method schema.

## Deploy

Create `.env.local` at the project root:

```bash
PRIVATE_KEY=0x...
WALLET_ADDRESS=0x...
```

The private key and wallet address must match. `.env.local` is ignored by Git
and should have mode `600`.

```bash
npm run deploy:bradbury
```

This uses the already-installed `genlayer-js` and `viem` dependencies. It does
not install anything. On success it:

1. Writes a non-secret deployment record to `deployments/bradbury.json`.
2. Adds `VITE_CONTRACT_ADDRESS` to `.env.local`.
3. Lets the frontend start with the deployed address already selected.

## Contract tests

The direct-mode tests require the optional `gltest` tooling:

```bash
python3 contract/test_grantos.py
```

Do not install it solely for deployment; Bradbury schema validation and
post-deployment source/schema verification are built into the deployment
script.
