// src/lib/genlayerClient.js
//
// Thin wrapper around genlayer-js. Every exported function here maps 1:1 to a
// public method on the GrantOS Intelligent Contract (see grantos.py). Keeping
// this mapping in one place means integration tests can verify each contract
// call independently of the UI that triggers it.

import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";

export { TransactionStatus };
const GEN_DECIMALS = 18;

/**
 * Build a genlayer-js client.
 * @param {string} account - the connected wallet address (from MetaMask), or undefined for read-only use.
 * @param {object} provider - the injected wallet provider used to sign write transactions.
 */
export function makeClient(account, provider) {
  return createClient({
    chain: testnetBradbury,
    ...(account ? { account } : {}),
    ...(provider ? { provider } : {}),
  });
}

function bradburyChainParams() {
  return {
    chainId: `0x${testnetBradbury.id.toString(16)}`,
    chainName: testnetBradbury.name,
    rpcUrls: [...testnetBradbury.rpcUrls.default.http],
    nativeCurrency: testnetBradbury.nativeCurrency,
    ...(testnetBradbury.blockExplorers?.default?.url
      ? { blockExplorerUrls: [testnetBradbury.blockExplorers.default.url] }
      : {}),
  };
}

function isMissingChainError(error) {
  const code = error?.code ?? error?.data?.originalError?.code;
  return code === 4902 || /unrecognized chain|unknown chain|chain.*not added/i.test(error?.message ?? "");
}

/**
 * Ensure the injected wallet is on Bradbury using standard EIP-1193 methods.
 * This deliberately avoids genlayer-js client.connect(), which also requests
 * MetaMask Snaps and fails on otherwise-compatible wallets that do not expose
 * wallet_getSnaps.
 */
export async function ensureBradburyNetwork(provider) {
  const chain = bradburyChainParams();
  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (String(currentChainId).toLowerCase() === chain.chainId.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainId }],
    });
  } catch (error) {
    if (!isMissingChainError(error)) {
      throw new Error(`Could not switch your wallet to GenLayer Bradbury: ${error.message}`);
    }

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [chain],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.chainId }],
      });
    } catch (addError) {
      throw new Error(`Could not add GenLayer Bradbury to your wallet: ${addError.message}`);
    }
  }
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
  const provider = window.ethereum;
  await ensureBradburyNetwork(provider);
  const client = makeClient(address, provider);
  return { address, client };
}

/**
 * Real wallet-side disconnect via EIP-2255's wallet_revokePermissions --
 * the same mechanism MetaMask's own documentation recommends for a
 * dApp-initiated "log out." Not every wallet implements it yet (it's a
 * newer standard), so this is deliberately best-effort: the caller should
 * always clear its own local connection state regardless of whether this
 * succeeds, since forgetting the account locally is what actually matters
 * for the app's own UI, and is the one thing guaranteed to work everywhere.
 *
 * Returns true if the wallet actually revoked its permission grant, false
 * if the method isn't supported (not an error -- just an older wallet).
 */
export async function disconnectWallet() {
  if (typeof window === "undefined" || !window.ethereum?.request) return false;
  try {
    await window.ethereum.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
    return true;
  } catch {
    // Method not supported, or the wallet rejected it -- not fatal. The
    // caller still clears local state; a future eth_requestAccounts call
    // may silently reconnect on wallets that don't support real revocation,
    // which is a known, documented limitation of the current standard, not
    // a bug in this app.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Writes — each mirrors a `@gl.public.write` method in grantos.py
// ---------------------------------------------------------------------------

/** Mirrors: create_grant(grant_id, grantee, project_description, milestone_ids, milestone_titles, milestone_criteria, milestone_amounts, total_amount) — payable */
export async function createGrant(client, contractAddress, { grantId, grantee, description, milestones, totalAmount }) {
  const milestoneAmounts = milestones.map((milestone) => parseGenAmount(milestone.amount));
  const totalAmountAtto = parseGenAmount(totalAmount);
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
      milestoneAmounts,
      totalAmountAtto,
    ],
    value: totalAmountAtto,
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
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: TransactionStatus.ACCEPTED });
  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    let detail = "The transaction reached consensus but contract execution failed.";
    try {
      const trace = await client.debugTraceTransaction({ hash: txHash });
      const executionMessage = trace.stderr || trace.stdout;
      if (executionMessage) detail = executionMessage;
    } catch {
      // Keep the stable fallback when trace RPC is unavailable.
    }
    throw new Error(detail);
  }
  return receipt;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Confirm that a write is actually reflected in contract state before telling
 * the user it succeeded.
 *
 * WHY THIS EXISTS: a write transaction reaches TransactionStatus.ACCEPTED a few
 * seconds before a fresh `get_grant` view call can see the new state (measured
 * on Bradbury: ~5s after ACCEPTED). Reporting "created" the instant the receipt
 * comes back means a user who immediately clicks "Load Grant" gets an
 * `[EXPECTED] grant not found` error for a grant that really was created — the
 * exact "the frontend said it worked but the grant isn't there" symptom this
 * fixes. Polling get_grant until it resolves makes the success message truthful
 * and guarantees the very next load will find the grant.
 *
 * Any read error during the window is treated as "not visible yet, retry" —
 * we only call this right after a receipt we already know was accepted, so the
 * grant is expected to exist; the only question is whether the read node has
 * caught up. Returns true once visible, false if it never appears in budget.
 */
export async function waitForGrantVisible(client, contractAddress, grantId, { attempts = 20, delayMs = 2500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await getGrant(client, contractAddress, grantId);
      return true;
    } catch {
      // Transient during the ACCEPTED -> readable window; keep polling.
    }
    await sleep(delayMs);
  }
  return false;
}

/**
 * Poll get_milestone_result until the AI verdict has actually settled.
 *
 * WHY THIS EXISTS: submit_milestone runs the non-deterministic LLM evaluation
 * (leader + validator via the Equivalence Principle). That path reaches an
 * ACCEPTED receipt whose execution result can still be NOT_VOTED — validators
 * have not finished voting — and the milestone result is not yet stored. So the
 * old flow said "Verification complete" while `get_milestone_result` still
 * returned `{}`. This polls for the real, non-empty verdict so the grantee is
 * shown what actually happened (completed / partial / not_completed) instead of
 * a premature "complete". Returns the result dict, or null if it hasn't settled
 * within the budget (in which case the caller should say so honestly rather
 * than claim a verdict).
 */
export async function waitForMilestoneResult(client, contractAddress, grantId, milestoneId, { attempts = 30, delayMs = 4000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await getMilestoneResult(client, contractAddress, grantId, milestoneId);
      if (result && Object.keys(result).length > 0) return result;
    } catch {
      // Transient read while consensus is still settling; keep polling.
    }
    await sleep(delayMs);
  }
  return null;
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

/** Convert a human-readable GEN value to its 18-decimal atto-GEN integer. */
export function parseGenAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) {
    throw new Error("Enter a non-negative GEN amount with no more than 18 decimal places.");
  }
  return parseUnits(text, GEN_DECIMALS);
}

/** Format an on-chain atto-GEN integer as a human-readable GEN amount. */
export function formatAmount(value) {
  try {
    const [whole, fraction = ""] = formatUnits(BigInt(value), GEN_DECIMALS).split(".");
    const formattedWhole = new Intl.NumberFormat("en-US").format(BigInt(whole));
    const trimmedFraction = fraction.replace(/0+$/, "");
    return trimmedFraction ? `${formattedWhole}.${trimmedFraction}` : formattedWhole;
  } catch {
    return String(value);
  }
}

/** Format values that are already human-readable, such as form input totals. */
export function formatInputAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 18 }).format(num);
}

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
    return { valid: false, sum: 0n, error: "At least one milestone is required." };
  }

  let milestoneAmounts;
  try {
    milestoneAmounts = milestones.map((milestone) => parseGenAmount(milestone.amount));
  } catch {
    return {
      valid: false,
      sum: 0n,
      error: "Invalid amount. Every milestone must have a non-negative GEN amount.",
    };
  }

  let totalAmountAtto;
  try {
    totalAmountAtto = parseGenAmount(totalAmount);
  } catch {
    return { valid: false, sum: 0n, error: "Total amount must be a valid number in GEN." };
  }
  if (totalAmountAtto <= 0n) {
    return { valid: false, sum: 0n, error: "Total amount must be greater than zero." };
  }

  const sum = milestoneAmounts.reduce((current, amount) => current + amount, 0n);
  if (sum !== totalAmountAtto) {
    return {
      valid: false,
      sum,
      error: `Milestone amounts sum to ${formatAmount(sum)} GEN, but total is ${formatAmount(totalAmountAtto)} GEN. They must match exactly.`,
    };
  }
  const ids = milestones.map((m) => m.id);
  if (new Set(ids).size !== ids.length) {
    return { valid: false, sum, error: "Milestone IDs must be unique." };
  }
  return { valid: true, sum, error: null };
}
