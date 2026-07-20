// src/components/__tests__/FunderDashboard.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FunderDashboard from "../FunderDashboard";

const DEFAULT_CTX = { client: { fake: true }, account: "0xTestFunderAccount", contractAddress: "0x1234567890123456789012345678901234567890" };

vi.mock("../../context/GrantOSContext", () => ({
  useGrantOS: vi.fn(),
}));

vi.mock("../../lib/genlayerClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createGrant: vi.fn(),
    waitForAccepted: vi.fn().mockResolvedValue({}),
    fetchGrantBundle: vi.fn(),
    resolvePendingReview: vi.fn(),
  };
});

import { useGrantOS } from "../../context/GrantOSContext";
import { createGrant, fetchGrantBundle, resolvePendingReview } from "../../lib/genlayerClient";

beforeEach(() => {
  vi.clearAllMocks();
  useGrantOS.mockReturnValue(DEFAULT_CTX);
});

describe("FunderDashboard — create grant", () => {
  it("blocks submission client-side when milestone amounts don't sum to the total (mirrors the on-chain assert)", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);

    await user.type(screen.getByTestId("m-amount-0"), "100");
    await user.type(screen.getByTestId("m-amount-1"), "200");
    await user.type(screen.getByTestId("total-amount-input"), "1000");
    await user.type(screen.getByTestId("grant-id-input"), "g1");
    await user.type(screen.getByTestId("grantee-input"), "0x999999999999999999999999999999999999999a");

    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-grant-msg").textContent).toMatch(/sum to 300/);
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("shows a clear error instead of 'NaN' when a milestone amount is negative", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);

    // type="number" inputs reject non-numeric keystrokes outright (in both
    // jsdom and real browsers), so garbage text like "abc" never reaches
    // state -- a negative number IS a value the input accepts, though, and
    // still needs validateMilestoneAmounts' guard.
    await user.type(screen.getByTestId("m-amount-0"), "-100");
    await user.type(screen.getByTestId("m-amount-1"), "600");
    await user.type(screen.getByTestId("total-amount-input"), "500");
    await user.type(screen.getByTestId("grant-id-input"), "g1");
    await user.type(screen.getByTestId("grantee-input"), "0x999999999999999999999999999999999999999a");

    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      const text = screen.getByTestId("create-grant-msg").textContent;
      expect(text).toMatch(/invalid amount/i);
      expect(text).not.toMatch(/NaN/);
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("blocks submission when every milestone row has been removed", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("total-amount-input"), "1000"); // isolate this test from the separate blank-total-amount check
    await user.type(screen.getByTestId("grantee-input"), "0x999999999999999999999999999999999999999a"); // isolate from the grantee-address check
    fireEvent.click(screen.getAllByText("×")[0]);
    fireEvent.click(screen.getAllByText("×")[0]);

    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-grant-msg").textContent).toMatch(/at least one milestone/i);
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("shows a clear error instead of crashing when the total amount is left blank (regression: this used to silently reach BigInt(NaN))", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);
    // Leave every amount field blank -- milestones default to 0 each, and
    // without the fix, total amount defaulting to 0 too would let this pass
    // validation and then crash deep inside createGrant() on BigInt(NaN).
    await user.type(screen.getByTestId("grant-id-input"), "g1");
    await user.type(screen.getByTestId("grantee-input"), "0x999999999999999999999999999999999999999a");
    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-grant-msg").textContent).toMatch(/enter a total amount/i);
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("shows a clear error instead of a raw checksum error when the grantee address is malformed", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("m-amount-0"), "400");
    await user.type(screen.getByTestId("m-amount-1"), "600");
    await user.type(screen.getByTestId("total-amount-input"), "1000");
    await user.type(screen.getByTestId("grant-id-input"), "g1");
    await user.type(screen.getByTestId("grantee-input"), "not-a-real-address");
    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-grant-msg").textContent).toMatch(/grantee wallet address isn't valid/i);
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("submits create_grant when amounts sum correctly, and reports success", async () => {
    createGrant.mockResolvedValue("0xTXHASH");
    const user = userEvent.setup();
    render(<FunderDashboard />);

    await user.type(screen.getByTestId("m-amount-0"), "400");
    await user.type(screen.getByTestId("m-amount-1"), "600");
    await user.type(screen.getByTestId("total-amount-input"), "1000");
    await user.type(screen.getByTestId("grant-id-input"), "g1");
    await user.type(screen.getByTestId("grantee-input"), "0x999999999999999999999999999999999999999a");

    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      expect(createGrant).toHaveBeenCalledTimes(1);
    });
    const args = createGrant.mock.calls[0][2];
    expect(args.grantId).toBe("g1");
    expect(args.totalAmount).toBe(1000);
    expect(args.milestones.map((m) => m.amount)).toEqual([400, 600]);

    await waitFor(() => {
      expect(screen.getByTestId("create-grant-msg").textContent).toMatch(/created and funded/);
    });
  });

  it("lets a funder approve a pending-review milestone, releasing funds", async () => {
    fetchGrantBundle.mockResolvedValue({
      grant: {
        funder: "0xF",
        grantee: "0xG",
        project_description: "desc",
        milestones: [{ id: "M1", title: "Deploy", criteria: "c1", amount: 100 }],
        status: "active",
      },
      progress: { pending_review: "M1" },
      results: {
        M1: {
          final_status: "partial",
          llm_status: "completed",
          quality_score: 55,
          criteria_met: [],
          criteria_not_met: ["quality too low"],
          feedback: "not quite there",
        },
      },
    });
    resolvePendingReview.mockResolvedValue("0xTXHASH2");

    const user = userEvent.setup();
    render(<FunderDashboard />);

    await user.type(screen.getByTestId("review-grant-id-input"), "g1");
    fireEvent.click(screen.getByTestId("load-review-btn"));

    await waitFor(() => expect(screen.getByTestId("pending-review-card")).toBeInTheDocument());
    expect(screen.getByText(/quality too low/)).toBeInTheDocument();

    fetchGrantBundle.mockResolvedValue({
      grant: { milestones: [{ id: "M1", title: "Deploy", criteria: "c1", amount: 100 }] },
      progress: { pending_review: "" },
      results: { M1: { final_status: "completed" } },
    });

    fireEvent.click(screen.getByTestId("approve-btn"));

    await waitFor(() => {
      expect(resolvePendingReview).toHaveBeenCalledWith(
        { fake: true },
        "0x1234567890123456789012345678901234567890",
        { grantId: "g1", milestoneId: "M1", approve: true }
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("review-msg").textContent).toMatch(/Approved/);
    });
  });
});

describe("FunderDashboard — wallet-connection gating (regression)", () => {
  // Regression tests for a real bug: `client` defaults to a truthy read-only
  // client even with no wallet connected, so the old `!client` check never
  // actually detected "wallet not connected." These re-mock the context with
  // account: null to prove writes are now correctly blocked with a clear
  // message, while reads (which don't need a wallet) still work.

  it("blocks create_grant and shows a clear message when no wallet is connected", async () => {
    useGrantOS.mockReturnValue({ client: { fake: true }, account: null, contractAddress: "0x1234567890123456789012345678901234567890" });

    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("m-amount-0"), "400");
    await user.type(screen.getByTestId("m-amount-1"), "600");
    await user.type(screen.getByTestId("total-amount-input"), "1000");
    fireEvent.click(screen.getByTestId("create-grant-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-grant-msg").textContent).toMatch(/connect your wallet/i);
    });
    expect(createGrant).not.toHaveBeenCalled();
  });

  it("blocks resolve_pending_review when no wallet is connected (previously had NO check at all)", async () => {
    useGrantOS.mockReturnValue({ client: { fake: true }, account: null, contractAddress: "0x1234567890123456789012345678901234567890" });

    fetchGrantBundle.mockResolvedValue({
      grant: { milestones: [{ id: "M1", title: "Deploy", criteria: "c1", amount: 100 }] },
      progress: { pending_review: "M1" },
      results: { M1: { final_status: "partial", criteria_met: [], criteria_not_met: [], feedback: "x" } },
    });

    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("review-grant-id-input"), "g1");
    fireEvent.click(screen.getByTestId("load-review-btn"));
    await waitFor(() => expect(screen.getByTestId("pending-review-card")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("approve-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("review-msg").textContent).toMatch(/connect your wallet/i);
    });
    expect(resolvePendingReview).not.toHaveBeenCalled();
  });

  it("still allows loading a grant for review with no wallet connected (it's a read, not a write)", async () => {
    useGrantOS.mockReturnValue({ client: { fake: true }, account: null, contractAddress: "0x1234567890123456789012345678901234567890" });

    fetchGrantBundle.mockResolvedValue({
      grant: { milestones: [{ id: "M1", title: "Deploy", criteria: "c1", amount: 100 }] },
      progress: { pending_review: "" },
      results: { M1: { final_status: "completed" } },
    });

    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("review-grant-id-input"), "g1");
    fireEvent.click(screen.getByTestId("load-review-btn"));

    await waitFor(() => expect(fetchGrantBundle).toHaveBeenCalled());
    expect(screen.getByText(/No milestone pending review/)).toBeInTheDocument();
  });
});

describe("FunderDashboard — live sum indicator", () => {
  it("shows a mismatch indicator as the funder types, before ever submitting", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("m-amount-0"), "400");
    await user.type(screen.getByTestId("m-amount-1"), "600");
    await user.type(screen.getByTestId("total-amount-input"), "999");

    expect(screen.getByTestId("sum-indicator").textContent).toMatch(/must match exactly/);
  });

  it("flips to 'matches' once the live sum equals the live total", async () => {
    const user = userEvent.setup();
    render(<FunderDashboard />);
    await user.type(screen.getByTestId("m-amount-0"), "400");
    await user.type(screen.getByTestId("m-amount-1"), "600");
    await user.type(screen.getByTestId("total-amount-input"), "1000");

    expect(screen.getByTestId("sum-indicator").textContent).toMatch(/— matches/);
  });
});
