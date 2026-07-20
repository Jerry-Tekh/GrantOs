"""
Deploy GrantOS to the GenLayer Bradbury testnet.

This script uses the real `genlayer-py` client SDK (pip install genlayer-py).
It is NOT run automatically for you — deploying requires YOUR wallet's private
key and a live connection to Bradbury's RPC endpoint, neither of which this
build environment has access to. Run this yourself, locally or in Claude Code,
after setting GRANTOS_DEPLOYER_PRIVATE_KEY.

Usage:
    pip install genlayer-py
    export GRANTOS_DEPLOYER_PRIVATE_KEY=0x...   # funder/deployer wallet
    python3 deploy.py
"""
import os
import sys
from pathlib import Path

from genlayer_py import create_client, testnet_bradbury
from genlayer_py.accounts import create_account

CONTRACT_PATH = Path(__file__).parent / "grantos.py"


def main():
    pk = os.environ.get("GRANTOS_DEPLOYER_PRIVATE_KEY")
    if not pk:
        print("ERROR: set GRANTOS_DEPLOYER_PRIVATE_KEY to your funder wallet's private key.")
        sys.exit(1)

    account = create_account(pk)
    client = create_client(chain=testnet_bradbury, account=account)

    print(f"Deploying from {account.address} to Bradbury...")
    code = CONTRACT_PATH.read_bytes()

    tx_hash = client.deploy_contract(code=code, args=[])
    print(f"Deploy tx: {tx_hash}")

    receipt = client.wait_for_transaction_receipt(transaction_hash=tx_hash)
    contract_address = receipt["data"]["contract_address"]
    print(f"GrantOS deployed at: {contract_address}")
    print("\nSave this address — the frontend (app.html) needs it to talk to your contract.")


if __name__ == "__main__":
    main()
