// src/lib/genlayerClient.js
//
// Thin wrapper around genlayer-js. Every exported function here maps 1:1 to a
// public method on the GrantOS Intelligent Contract (see grantos.py). Keeping
// this mapping in one place means integration tests can verify each contract
// call independently of the UI that triggers it.

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

export { TransactionStatus };

/**
 * Build a genlayer-js client.
 * @param {string} account - the connected wallet address (from MetaMask), or undefined for read-only use.
 */
export function makeClient(account) {
  return createClient({
    chain: testnetBradbury,
    ...(account ? { account } : {}),
  });
}

async function requestWalletAccount() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Install MetaMask (or another injected wallet) to continue.");
  }
  const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
  return address;
}

export async function connectWallet() {
  const address = await requestWalletAccount();
  return { address, client: makeClient(address) };
}

// ---------------------------------------------------------------------------
// Writes — each mirrors a `@gl.public.write` method in grantos.py
// ---------------------------------------------------------------------------

/** Mirrors: create_grant(grant_id, grantee, project_description, milestone_ids, milestone_titles, milestone_criteria, milestone_amounts, total_amount) — payable */
export async function createGrant(client, contractAddress, { grantId, grantee, description, milestones, totalAmount }) {
  const txHash = await client.writeContract({
    address: contractAddress,
    functionName: "create_grant",
    args: [
      grantId,
      normalizeAddress(grantee),
      description,
      milestones.map((m) => m.id),
      milestones.map((m) => m.title),
      milestones.map((m) => m.criteria),
      milestones.map((m) => m.amount),
      totalAmount,
    ],
    value: BigInt(totalAmount),
  });
  return txHash;
}

/** Mirrors: submit_milestone(grant_id, milestone_id, report_text, evidence_urls) */
export async function submitMilestone(client, contractAddress, { grantId, milestoneId, report, evidenceUrls }) {
  const txHash = await client.writeContract({
    address: contractAddress,
    functionName: "submit_milestone",
    args: [grantId, milestoneId, report, evidenceUrls.slice(0, 5)],
    value: 0n,
  });
  return txHash;
}

/** Mirrors: resolve_pending_review(grant_id, milestone_id, approve) */
export async function resolvePendingReview(client, contractAddress, { grantId, milestoneId, approve }) {
  const txHash = await client.writeContract({
    address: contractAddress,
    functionName: "resolve_pending_review",
    args: [grantId, milestoneId, approve],
    value: 0n,
  });
  return txHash;
}

export async function waitForAccepted(client, txHash) {
  return client.waitForTransactionReceipt({ hash: txHash, status: TransactionStatus.ACCEPTED });
}

// ---------------------------------------------------------------------------
// Reads — each mirrors a `@gl.public.view` method in grantos.py
// ---------------------------------------------------------------------------

/** Mirrors: get_grant(grant_id) -> dict */
export async function getGrant(client, contractAddress, grantId) {
  return client.readContract({
    address: contractAddress,
    functionName: "get_grant",
    args: [grantId],
  });
}

/** Mirrors: get_grant_progress(grant_id) -> dict (stable schema) */
export async function getGrantProgress(client, contractAddress, grantId) {
  return client.readContract({
    address: contractAddress,
    functionName: "get_grant_progress",
    args: [grantId],
  });
}

/** Mirrors: get_milestone_result(grant_id, milestone_id) -> dict */
export async function getMilestoneResult(client, contractAddress, grantId, milestoneId) {
  return client.readContract({
    address: contractAddress,
    functionName: "get_milestone_result",
    args: [grantId, milestoneId],
  });
}

/** Convenience: fetch a grant plus its progress plus every milestone's result in one shot. */
export async function fetchGrantBundle(client, contractAddress, grantId) {
  const [grant, progress] = await Promise.all([
    getGrant(client, contractAddress, grantId),
    getGrantProgress(client, contractAddress, grantId),
  ]);
  const results = {};
  for (const m of grant.milestones) {
    results[m.id] = await getMilestoneResult(client, contractAddress, grantId, m.id);
  }
  return { grant, progress, results };
}

// ---------------------------------------------------------------------------
// Client-side validation mirroring on-chain asserts (fail fast before spending gas)
// ---------------------------------------------------------------------------

/** Consistent thousand-separated formatting for GEN amounts across the app. */
export function formatAmount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return new Intl.NumberFormat("en-US").format(num);
}

import { isAddress, getAddress } from "viem";

/**
 * A GenLayer/EVM-style address. Delegates to viem's real EIP-55 checksum
 * validation rather than a plain hex-format regex -- confirmed directly
 * that a naive `/^0x[a-fA-F0-9]{40}$/` regex has a false positive here: it
 * accepts all-uppercase addresses (they match the regex) that viem actually
 * rejects (EIP-55 checksums are never all-uppercase), and it accepts
 * mixed-case addresses with an incorrect checksum, which would otherwise
 * sail past this check only to fail later with a confusing raw error deep
 * inside the write call ("Address ... is invalid ... must match its
 * checksum counterpart ... Version: viem@2.55.2").
 */
export function isValidAddress(address) {
  return typeof address === "string" && isAddress(address);
}

/**
 * All-lowercase addresses are valid (checksum-agnostic) but not in their
 * canonical checksummed form. Normalizing before a write call means a
 * common case -- a user pasting an address in lowercase -- "just works"
 * instead of depending on every input already being perfectly checksummed.
 * Returns the address unchanged if it isn't valid; validate separately.
 */
export function normalizeAddress(address) {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

/**
 * Shared precondition check for every write/read guard in the UI: is there
 * a syntactically valid contract address to call, and (for writes only) is
 * a wallet connected? Returns an error string to show the user, or null if
 * everything checks out.
 */
export function checkCallPreconditions({ contractAddress, account, requireWallet }) {
  if (requireWallet && !account) return "Connect your wallet to continue.";
  if (!contractAddress) return "Enter the deployed GrantOS contract address above.";
  if (!isValidAddress(contractAddress)) return "The contract address above isn't valid -- it should be 0x followed by 40 hex characters.";
  return null;
}

/** Mirrors the assert in create_grant: milestone amounts must sum to total_amount exactly. */
export function validateMilestoneAmounts(milestones, totalAmount) {
  if (milestones.length === 0) {
    return { valid: false, sum: 0, error: "At least one milestone is required." };
  }

  const badAmount = milestones.find((m) => !Number.isFinite(Number(m.amount)) || Number(m.amount) < 0);
  if (badAmount) {
    return {
      valid: false,
      sum: NaN,
      error: `Milestone "${badAmount.id || "(no id)"}" has an invalid amount. Amounts must be non-negative numbers.`,
    };
  }
  if (!Number.isFinite(Number(totalAmount))) {
    return { valid: false, sum: NaN, error: "Total amount must be a valid number." };
  }

  const sum = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
  if (sum !== Number(totalAmount)) {
    return { valid: false, sum, error: `Milestone amounts sum to ${sum}, but total is ${totalAmount}. They must match exactly.` };
  }
  const ids = milestones.map((m) => m.id);
  if (new Set(ids).size !== ids.length) {
    return { valid: false, sum, error: "Milestone IDs must be unique." };
  }
  return { valid: true, sum, error: null };
}
