# GrantOS Intelligent Contract

This is the GenLayer Intelligent Contract that the React app (one level up) talks to.

- `grantos.py` — the contract itself
- `test_grantos.py` — 57 tests, run for real against the GenVM engine (`gltest.direct`)
- `deploy.py` — deploys to Bradbury using `genlayer-py`

## Verified deployable, with the real GenLayer tooling

Before shipping, this contract was checked with `genvm-linter` (`pip install
genvm-linter`, the real tool behind GenLayer's official `genvm-lint` skill)
— not just my own hand-written tests. It downloads the actual GenVM engine
and validates against it for real:

```
$ genvm-lint check grantos.py
✓ Lint passed (3 checks)
✓ Validation passed
  Contract: GrantOS
  Methods: 6 (3 view, 3 write)

$ genvm-lint typecheck grantos.py
✓ No type errors found

$ genvm-lint schema grantos.py
Methods (6):
  - create_grant(grant_id, grantee, project_description, milestone_ids, milestone_titles, milestone_criteria, milestone_amounts, total_amount) [write]
  - get_grant(grant_id) [view]
  - get_grant_progress(grant_id) [view]
  - get_milestone_result(grant_id, milestone_id) [view]
  - resolve_pending_review(grant_id, milestone_id, approve) [write]
  - submit_milestone(grant_id, milestone_id, report_text, evidence_urls) [write]
```

That schema output is the authoritative ABI — and it's an exact match for
every `functionName` the React app calls in `src/lib/genlayerClient.js`.

**One real bug this caught**: the `Depends` header initially used a bare
semver-style pin (`py-genlayer:v0.2.16`) to avoid the ambiguity of `latest`
possibly resolving unpredictably. That actually broke the SDK loader —
`"Depends": "py-genlayer:v0.2.16"` fails with `Failed to load SDK: filename
'runners/py-genlayer/v0/.2.16.tar' not found`, because the loader splits on
`.` to build a path, and a dotted semver string isn't a valid identifier in
that scheme. The three formats that are actually valid (confirmed against
real docs examples and the linter) are `latest`, `test`, or a specific
content-addressed hash like `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
Reverted to `latest`, which the linter confirms validates cleanly.

## Run the contract tests

```bash
pip install genlayer-test genlayer-py --break-system-packages
python3 test_grantos.py
```

## Run the linter yourself

```bash
pip install genvm-linter
genvm-lint check grantos.py
```

## Deploy

```bash
pip install genlayer-py
export GRANTOS_DEPLOYER_PRIVATE_KEY=0x...   # your funder wallet
python3 deploy.py
```

Copy the printed contract address into the React app's header field (Connect Wallet -> paste address).
