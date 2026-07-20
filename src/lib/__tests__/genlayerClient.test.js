// src/lib/__tests__/genlayerClient.test.js
import { describe, it, expect, vi } from "vitest";
import {
  createGrant,
  submitMilestone,
  resolvePendingReview,
  getGrant,
  getGrantProgress,
  getMilestoneResult,
  fetchGrantBundle,
  validateMilestoneAmounts,
  waitForAccepted,
  TransactionStatus,
  isValidAddress,
  normalizeAddress,
  checkCallPreconditions,
  formatAmount,
} from "../genlayerClient";

function fakeClient(overrides = {}) {
  return {
    writeContract: vi.fn().mockResolvedValue("0xTXHASH"),
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "ACCEPTED" }),
    ...overrides,
  };
}

const ADDR = "0xCONTRACT";

describe("createGrant -> create_grant(grant_id, grantee, project_description, milestone_ids, milestone_titles, milestone_criteria, milestone_amounts, total_amount)", () => {
  it("calls writeContract with the exact function name and argument shape the contract expects", async () => {
    const client = fakeClient();
    const milestones = [
      { id: "M1", title: "Deploy", criteria: "on bradbury", amount: 400 },
      { id: "M2", title: "Frontend", criteria: "live demo", amount: 600 },
    ];

    const tx = await createGrant(client, ADDR, {
      grantId: "g1",
      grantee: "0xGrantee",
      description: "Build GrantOS",
      milestones,
      totalAmount: 1000,
    });

    expect(tx).toBe("0xTXHASH");
    expect(client.writeContract).toHaveBeenCalledTimes(1);
    const call = client.writeContract.mock.calls[0][0];
    expect(call.address).toBe(ADDR);
    expect(call.functionName).toBe("create_grant");
    expect(call.args).toEqual([
      "g1",
      "0xGrantee",
      "Build GrantOS",
      ["M1", "M2"],
      ["Deploy", "Frontend"],
      ["on bradbury", "live demo"],
      [400, 600],
      1000,
    ]);
    // payable: value must equal total_amount, sent as a BigInt (matches contract's u256 escrow check)
    expect(call.value).toBe(1000n);
  });

  it("normalizes a valid but non-checksummed grantee address before sending -- confirmed directly that an un-normalized mixed-case address with a bad checksum fails deep inside the underlying SDK with a raw, confusing error", async () => {
    const client = fakeClient();
    await createGrant(client, ADDR, {
      grantId: "g1",
      grantee: "0xabcdef1234567890abcdef1234567890abcdef12", // valid, all-lowercase
      description: "d",
      milestones: [{ id: "M1", title: "t", criteria: "c", amount: 100 }],
      totalAmount: 100,
    });
    const sentGrantee = client.writeContract.mock.calls[0][0].args[1];
    expect(sentGrantee).not.toBe("0xabcdef1234567890abcdef1234567890abcdef12"); // now checksummed (case changed)
    expect(sentGrantee.toLowerCase()).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
  });
});

describe("submitMilestone -> submit_milestone(grant_id, milestone_id, report_text, evidence_urls)", () => {
  it("calls writeContract with correct args and caps evidence URLs at 5 (matches MAX_EVIDENCE_URLS)", async () => {
    const client = fakeClient();
    const urls = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"];

    await submitMilestone(client, ADDR, {
      grantId: "g1",
      milestoneId: "M1",
      report: "done",
      evidenceUrls: urls,
    });

    const call = client.writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("submit_milestone");
    expect(call.args).toEqual(["g1", "M1", "done", ["u1", "u2", "u3", "u4", "u5"]]);
    expect(call.args[3]).toHaveLength(5);
    expect(call.value).toBe(0n);
  });
});

describe("resolvePendingReview -> resolve_pending_review(grant_id, milestone_id, approve)", () => {
  it("calls writeContract with correct args for approval", async () => {
    const client = fakeClient();
    await resolvePendingReview(client, ADDR, { grantId: "g1", milestoneId: "M1", approve: true });
    const call = client.writeContract.mock.calls[0][0];
    expect(call.functionName).toBe("resolve_pending_review");
    expect(call.args).toEqual(["g1", "M1", true]);
  });

  it("calls writeContract with correct args for rejection", async () => {
    const client = fakeClient();
    await resolvePendingReview(client, ADDR, { grantId: "g1", milestoneId: "M1", approve: false });
    const call = client.writeContract.mock.calls[0][0];
    expect(call.args).toEqual(["g1", "M1", false]);
  });
});

describe("read wrappers map to the right view functions", () => {
  it("getGrant -> get_grant(grant_id)", async () => {
    const client = fakeClient({ readContract: vi.fn().mockResolvedValue({ status: "active" }) });
    const result = await getGrant(client, ADDR, "g1");
    expect(client.readContract).toHaveBeenCalledWith({ address: ADDR, functionName: "get_grant", args: ["g1"] });
    expect(result.status).toBe("active");
  });

  it("getGrantProgress -> get_grant_progress(grant_id)", async () => {
    const client = fakeClient({ readContract: vi.fn().mockResolvedValue({ progress_pct: 50 }) });
    await getGrantProgress(client, ADDR, "g1");
    expect(client.readContract).toHaveBeenCalledWith({ address: ADDR, functionName: "get_grant_progress", args: ["g1"] });
  });

  it("getMilestoneResult -> get_milestone_result(grant_id, milestone_id)", async () => {
    const client = fakeClient({ readContract: vi.fn().mockResolvedValue({ final_status: "completed" }) });
    await getMilestoneResult(client, ADDR, "g1", "M1");
    expect(client.readContract).toHaveBeenCalledWith({
      address: ADDR,
      functionName: "get_milestone_result",
      args: ["g1", "M1"],
    });
  });
});

describe("fetchGrantBundle", () => {
  it("fetches the grant, its progress, and every milestone's result", async () => {
    const readContract = vi.fn().mockImplementation(({ functionName, args }) => {
      if (functionName === "get_grant") {
        return Promise.resolve({
          funder: "0xF",
          grantee: "0xG",
          project_description: "desc",
          milestones: [
            { id: "M1", title: "t1", criteria: "c1", amount: 400 },
            { id: "M2", title: "t2", criteria: "c2", amount: 600 },
          ],
          total_amount: 1000,
          released: 400,
          status: "active",
          completed_milestones: ["M1"],
          pending_review: "",
        });
      }
      if (functionName === "get_grant_progress") {
        return Promise.resolve({
          completed_milestones: 1,
          total_milestones: 2,
          progress_pct: 50,
          amount_released: 400,
          amount_remaining: 600,
          status: "active",
          pending_review: "",
        });
      }
      if (functionName === "get_milestone_result") {
        const [, milestoneId] = args;
        return Promise.resolve({ milestone_id: milestoneId, final_status: "completed", quality_score: 85 });
      }
      throw new Error("unexpected call: " + functionName);
    });
    const client = fakeClient({ readContract });

    const bundle = await fetchGrantBundle(client, ADDR, "g1");

    expect(bundle.grant.milestones).toHaveLength(2);
    expect(bundle.progress.progress_pct).toBe(50);
    expect(Object.keys(bundle.results)).toEqual(["M1", "M2"]);
    expect(bundle.results.M1.final_status).toBe("completed");
    // one get_grant + one get_grant_progress + one get_milestone_result per milestone
    expect(readContract).toHaveBeenCalledTimes(4);
  });
});

describe("validateMilestoneAmounts — mirrors the on-chain assert in create_grant", () => {
  it("passes when amounts sum exactly to total", () => {
    const r = validateMilestoneAmounts([{ id: "M1", amount: 400 }, { id: "M2", amount: 600 }], 1000);
    expect(r.valid).toBe(true);
  });

  it("fails when amounts do not sum to total (same condition the contract reverts on)", () => {
    const r = validateMilestoneAmounts([{ amount: 200 }, { amount: 300 }], 1000);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/sum to 500/);
  });

  it("fails with no milestones", () => {
    const r = validateMilestoneAmounts([], 0);
    expect(r.valid).toBe(false);
  });

  it("gives a clear error for a non-numeric milestone amount instead of silently producing NaN", () => {
    const r = validateMilestoneAmounts([{ id: "M1", amount: NaN }, { id: "M2", amount: 100 }], 100);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalid amount/i);
    expect(r.error).not.toMatch(/NaN/); // must not leak "sum to NaN" to the user
  });

  it("gives a clear error for a negative milestone amount", () => {
    const r = validateMilestoneAmounts([{ id: "M1", amount: -50 }], -50);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/invalid amount/i);
  });

  it("gives a clear error for a non-numeric total amount", () => {
    const r = validateMilestoneAmounts([{ id: "M1", amount: 100 }], NaN);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/total amount must be a valid number/i);
  });

  it("fails with duplicate milestone ids", () => {
    const r = validateMilestoneAmounts([{ id: "M1", amount: 5 }, { id: "M1", amount: 5 }], 10);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/unique/);
  });
});

describe("formatAmount", () => {
  it("formats large numbers with thousand separators", () => {
    expect(formatAmount(1234567)).toBe("1,234,567");
  });
  it("leaves small numbers unchanged in appearance", () => {
    expect(formatAmount(400)).toBe("400");
  });
  it("handles zero", () => {
    expect(formatAmount(0)).toBe("0");
  });
  it("falls back to a plain string for non-finite input rather than throwing", () => {
    expect(formatAmount(NaN)).toBe("NaN");
    expect(formatAmount(undefined)).toBe("undefined");
  });
});

describe("isValidAddress", () => {
  it("accepts a properly formatted address", () => {
    expect(isValidAddress("0x1234567890123456789012345678901234567890")).toBe(true);
  });
  it("rejects addresses missing the 0x prefix", () => {
    expect(isValidAddress("1234567890123456789012345678901234567890")).toBe(false);
  });
  it("rejects addresses with the wrong length", () => {
    expect(isValidAddress("0x1234")).toBe(false);
  });
  it("rejects non-hex characters", () => {
    expect(isValidAddress("0xCONTRACTCONTRACTCONTRACTCONTRACTCONTRACT")).toBe(false);
  });
  it("rejects non-string input", () => {
    expect(isValidAddress(undefined)).toBe(false);
    expect(isValidAddress(null)).toBe(false);
  });
  it("accepts an all-lowercase address (checksum-agnostic, no checksum to violate)", () => {
    expect(isValidAddress("0xabcdef1234567890abcdef1234567890abcdef12")).toBe(true);
  });
  it(
    "rejects an all-uppercase address -- regression: a naive hex-format regex " +
      "would accept this (matches [a-fA-F0-9]) but real EIP-55 checksums are never " +
      "all-uppercase, so it would have failed later with a raw error from deep inside the write call",
    () => {
      expect(isValidAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(false);
    }
  );
  it("rejects a mixed-case address with an incorrect checksum", () => {
    // Confirmed directly against viem: this exact string is well-formed hex
    // but does not match its EIP-55 checksum.
    expect(isValidAddress("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")).toBe(false);
  });
});

describe("normalizeAddress", () => {
  it("converts a valid all-lowercase address to its canonical checksummed form", () => {
    const result = normalizeAddress("0xabcdef1234567890abcdef1234567890abcdef12");
    expect(result).not.toBe("0xabcdef1234567890abcdef1234567890abcdef12"); // case changed
    expect(result.toLowerCase()).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
    expect(isValidAddress(result)).toBe(true); // and the result itself now validates
  });
  it("returns the input unchanged if it isn't a valid address, rather than throwing", () => {
    expect(normalizeAddress("not-an-address")).toBe("not-an-address");
  });
});

describe("checkCallPreconditions", () => {
  const VALID = "0x1234567890123456789012345678901234567890";

  it("passes when everything is valid", () => {
    expect(checkCallPreconditions({ contractAddress: VALID, account: "0xAcct", requireWallet: true })).toBeNull();
  });
  it("requires a wallet for writes", () => {
    expect(checkCallPreconditions({ contractAddress: VALID, account: null, requireWallet: true })).toMatch(/connect your wallet/i);
  });
  it("does not require a wallet for reads", () => {
    expect(checkCallPreconditions({ contractAddress: VALID, account: null, requireWallet: false })).toBeNull();
  });
  it("requires a contract address", () => {
    expect(checkCallPreconditions({ contractAddress: "", account: "0xAcct", requireWallet: true })).toMatch(/enter the deployed/i);
  });
  it("rejects a malformed contract address with a clear message, not a raw SDK error", () => {
    const msg = checkCallPreconditions({ contractAddress: "not-an-address", account: "0xAcct", requireWallet: true });
    expect(msg).toMatch(/isn't valid/i);
  });
});

describe("waitForAccepted", () => {
  it("waits with TransactionStatus.ACCEPTED", async () => {
    const client = fakeClient();
    await waitForAccepted(client, "0xTX");
    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xTX", status: TransactionStatus.ACCEPTED });
  });
});
