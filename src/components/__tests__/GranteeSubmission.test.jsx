// src/components/__tests__/GranteeSubmission.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GranteeSubmission from "../GranteeSubmission";

const DEFAULT_CTX = { client: { fake: true }, account: "0xTestGranteeAccount", contractAddress: "0x1234567890123456789012345678901234567890" };

vi.mock("../../context/GrantOSContext", () => ({
  useGrantOS: vi.fn(),
}));

vi.mock("../../lib/genlayerClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    submitMilestone: vi.fn(),
    waitForAccepted: vi.fn().mockResolvedValue({}),
    waitForMilestoneResult: vi.fn().mockResolvedValue({ final_status: "completed" }),
  };
});

import { useGrantOS } from "../../context/GrantOSContext";
import { submitMilestone } from "../../lib/genlayerClient";

beforeEach(() => {
  vi.clearAllMocks();
  useGrantOS.mockReturnValue(DEFAULT_CTX);
});

describe("GranteeSubmission", () => {
  it("requires a grant id and milestone id before submitting", async () => {
    render(<GranteeSubmission />);
    fireEvent.click(screen.getByTestId("submit-milestone-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("submit-msg").textContent).toMatch(/required/);
    });
    expect(submitMilestone).not.toHaveBeenCalled();
  });

  it("submits with trimmed evidence URLs capped at 3, matching the contract's MAX_EVIDENCE_URLS", async () => {
    submitMilestone.mockResolvedValue("0xTXHASH");
    const user = userEvent.setup();
    render(<GranteeSubmission />);

    await user.type(screen.getByTestId("s-grant-id"), "g1");
    await user.type(screen.getByTestId("s-milestone-id"), "M1");
    await user.type(screen.getByTestId("s-report"), "Deployed the contract.");
    await user.type(
      screen.getByTestId("s-urls"),
      "  https://github.com/a/b  \nhttps://demo.example.com\n\nhttps://x.com\nhttps://y.com\nhttps://z.com\nhttps://overflow.com"
    );

    fireEvent.click(screen.getByTestId("submit-milestone-btn"));

    await waitFor(() => expect(submitMilestone).toHaveBeenCalledTimes(1));
    const args = submitMilestone.mock.calls[0][2];
    expect(args.grantId).toBe("g1");
    expect(args.milestoneId).toBe("M1");
    expect(args.evidenceUrls).toHaveLength(3);
    expect(args.evidenceUrls[0]).toBe("https://github.com/a/b"); // trimmed
    expect(args.evidenceUrls).not.toContain("https://overflow.com");

    await waitFor(() => {
      expect(screen.getByTestId("submit-msg").textContent).toMatch(/Verification complete/);
    });
  });

  it("surfaces contract errors (e.g. sequential-milestone violation) to the grantee", async () => {
    submitMilestone.mockRejectedValue(new Error("[EXPECTED] must complete milestone 'M1' before 'M2'"));
    const user = userEvent.setup();
    render(<GranteeSubmission />);

    await user.type(screen.getByTestId("s-grant-id"), "g1");
    await user.type(screen.getByTestId("s-milestone-id"), "M2");
    fireEvent.click(screen.getByTestId("submit-milestone-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("submit-msg").textContent).toMatch(/before 'M2'/);
    });
  });

  it("shows a live URL count as the grantee types, and warns past the 3-URL cap", async () => {
    const user = userEvent.setup();
    render(<GranteeSubmission />);
    await user.type(screen.getByTestId("s-urls"), "a\nb\nc\nd\ne\nf");
    expect(screen.getByText(/3\/3/)).toBeInTheDocument();
    expect(screen.getByText(/Only the first 3 URLs will be submitted/)).toBeInTheDocument();
  });
});

describe("GranteeSubmission — wallet-connection gating (regression)", () => {
  // Regression test for the same `!client` bug found in FunderDashboard:
  // client is truthy by default even with no wallet connected, so the check
  // must be on `account` specifically.
  it("blocks submission and shows a clear message when no wallet is connected", async () => {
    useGrantOS.mockReturnValue({ client: { fake: true }, account: null, contractAddress: "0x1234567890123456789012345678901234567890" });

    const user = userEvent.setup();
    render(<GranteeSubmission />);
    await user.type(screen.getByTestId("s-grant-id"), "g1");
    await user.type(screen.getByTestId("s-milestone-id"), "M1");
    fireEvent.click(screen.getByTestId("submit-milestone-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("submit-msg").textContent).toMatch(/connect your wallet/i);
    });
    expect(submitMilestone).not.toHaveBeenCalled();
  });
});
