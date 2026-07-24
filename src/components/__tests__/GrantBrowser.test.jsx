// src/components/__tests__/GrantBrowser.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GrantBrowser from "../GrantBrowser";

vi.mock("../../context/GrantOSContext", () => ({
  useGrantOS: () => ({
    client: { fake: true },
    contractAddress: "0x1234567890123456789012345678901234567890",
  }),
}));

vi.mock("../../lib/genlayerClient", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchGrantBundle: vi.fn() };
});

import { fetchGrantBundle } from "../../lib/genlayerClient";

beforeEach(() => vi.clearAllMocks());

describe("GrantBrowser", () => {
  it("renders get_grant_progress()'s stable schema fields and one evidence viewer per milestone", async () => {
    fetchGrantBundle.mockResolvedValue({
      grant: {
        funder: "0xFunder",
        grantee: "0xGrantee",
        project_description: "Build GrantOS",
        milestones: [
          { id: "M1", title: "Deploy contract", criteria: "on bradbury", amount: "400000000000000000000" },
          { id: "M2", title: "Frontend live", criteria: "demoable", amount: "600000000000000000000" },
        ],
        status: "active",
      },
      progress: {
        completed_milestones: 1,
        total_milestones: 2,
        progress_pct: 50,
        amount_released: "400000000000000000000",
        amount_remaining: "600000000000000000000",
        status: "active",
        pending_review: "",
      },
      results: {
        M1: {
          final_status: "completed",
          llm_status: "completed",
          quality_score: 85,
          criteria_met: ["deployed", "verified"],
          criteria_not_met: [],
          feedback: "Solid work.",
        },
        M2: {},
      },
    });

    const user = userEvent.setup();
    render(<GrantBrowser />);
    await user.type(screen.getByTestId("b-grant-id"), "g1");
    fireEvent.click(screen.getByTestId("load-grant-btn"));

    await waitFor(() => expect(screen.getByTestId("grant-detail")).toBeInTheDocument());

    expect(fetchGrantBundle).toHaveBeenCalledWith({ fake: true }, "0x1234567890123456789012345678901234567890", "g1");
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "50%" });
    expect(screen.getByText(/1\/2 milestones complete/)).toBeInTheDocument();
    expect(screen.getByText(/400 released \/ 600 remaining/)).toBeInTheDocument();
    expect(screen.getByTestId("milestone-card-M1")).toBeInTheDocument();
    expect(screen.getByTestId("milestone-card-M2")).toBeInTheDocument();
    expect(screen.getByText(/No submission yet for M2/)).toBeInTheDocument();
  });

  it("formats large GEN amounts with thousand separators instead of raw numbers", async () => {
    fetchGrantBundle.mockResolvedValue({
      grant: {
        funder: "0xF", grantee: "0xG", project_description: "d", status: "active",
        milestones: [{ id: "M1", title: "Big milestone", criteria: "c", amount: "1250000000000000000000000" }],
      },
      progress: {
        completed_milestones: 0, total_milestones: 1, progress_pct: 0,
        amount_released: "2500000000000000000000000",
        amount_remaining: "1250000000000000000000000",
        status: "active",
        pending_review: "",
      },
      results: {},
    });
    const user = userEvent.setup();
    render(<GrantBrowser />);
    await user.type(screen.getByTestId("b-grant-id"), "g1");
    fireEvent.click(screen.getByTestId("load-grant-btn"));
    await waitFor(() => expect(screen.getByTestId("grant-detail")).toBeInTheDocument());

    expect(screen.getByText(/2,500,000 released \/ 1,250,000 remaining/)).toBeInTheDocument();
    expect(screen.getByText(/1,250,000 GEN/)).toBeInTheDocument();
  });

  it("surfaces load errors instead of a blank screen", async () => {
    fetchGrantBundle.mockRejectedValue(new Error("grant not found"));
    const user = userEvent.setup();
    render(<GrantBrowser />);
    await user.type(screen.getByTestId("b-grant-id"), "missing");
    fireEvent.click(screen.getByTestId("load-grant-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("browse-error").textContent).toMatch(/grant not found/);
    });
  });

  it("requires a grant id before loading", async () => {
    render(<GrantBrowser />);
    fireEvent.click(screen.getByTestId("load-grant-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("browse-error").textContent).toMatch(/enter a grant id/i);
    });
    expect(fetchGrantBundle).not.toHaveBeenCalled();
  });

  it(
    "loads successfully with no wallet connected -- reading a grant is a public view call, " +
      "not a transaction, and should never require a connected wallet (the mocked context " +
      "here has no `account` field at all)",
    async () => {
      fetchGrantBundle.mockResolvedValue({
        grant: { funder: "0xF", grantee: "0xG", project_description: "d", milestones: [], status: "active" },
        progress: {
          completed_milestones: 0,
          total_milestones: 0,
          progress_pct: 0,
          amount_released: 0,
          amount_remaining: 0,
          status: "active",
          pending_review: "",
        },
        results: {},
      });
      const user = userEvent.setup();
      render(<GrantBrowser />);
      await user.type(screen.getByTestId("b-grant-id"), "g1");
      fireEvent.click(screen.getByTestId("load-grant-btn"));
      await waitFor(() => expect(screen.getByTestId("grant-detail")).toBeInTheDocument());
    }
  );
});
