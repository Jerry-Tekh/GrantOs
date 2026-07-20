# GrantOS Intelligent Contract

This is the GenLayer Intelligent Contract that the React app (one level up) talks to.

- `grantos.py` — the contract itself
- `test_grantos.py` — 28 tests, run for real against the GenVM engine (`gltest.direct`)
- `deploy.py` — deploys to Bradbury using `genlayer-py`

## Run the contract tests

```bash
pip install genlayer-test genlayer-py --break-system-packages
python3 test_grantos.py
```

## Deploy

```bash
pip install genlayer-py
export GRANTOS_DEPLOYER_PRIVATE_KEY=0x...   # your funder wallet
python3 deploy.py
```

Copy the printed contract address into the React app's header field (Connect Wallet -> paste address).
