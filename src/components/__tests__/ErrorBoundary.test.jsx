// src/components/__tests__/ErrorBoundary.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";

// Regression test for a real, confirmed bug: without an error boundary, an
// uncaught render error anywhere in the tree unmounted the ENTIRE app --
// verified directly by triggering one before this fix existed (body content
// dropped to an empty <div></div>, header included). These tests prove a
// crash in one panel now shows a contained fallback instead, with the
// header, nav, and other tabs still fully intact and usable.

vi.mock("../../lib/genlayerClient", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchGrantBundle: vi.fn().mockResolvedValue({
      // Malformed on purpose: no `.milestones`, simulating an unexpected
      // contract response shape reaching the render path.
      grant: { funder: "0xF", grantee: "0xG", project_description: "d", status: "active" },
      progress: {
        completed_milestones: 0, total_milestones: 0, progress_pct: 0,
        amount_released: 0, amount_remaining: 0, status: "active", pending_review: "",
      },
      results: {},
    }),
  };
});

describe("ErrorBoundary", () => {
  it("contains a panel crash instead of blanking the whole app", async () => {
    // Render errors are noisy in test output by design (React logs them);
    // silence just for this test so the expected crash doesn't look like a
    // test failure in the runner output.
    const originalError = console.error;
    console.error = () => {};

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByTestId("contract-address-input"), "0x1234567890123456789012345678901234567890");
    fireEvent.click(screen.getByTestId("tab-browse"));
    await user.type(screen.getByTestId("b-grant-id"), "g1");
    fireEvent.click(screen.getByTestId("load-grant-btn"));

    // The crashed panel shows a contained fallback...
    const fallback = await screen.findByTestId("panel-error-boundary-browse");
    expect(fallback).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();

    // ...while the header, nav, and the OTHER tabs are completely unaffected.
    expect(screen.getByTestId("connect-btn")).toBeInTheDocument();
    expect(screen.getByTestId("contract-address-input")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-funder"));
    expect(screen.getByText("Create a grant")).toBeInTheDocument();

    console.error = originalError;
  });

  it("lets the user retry a crashed panel with 'Try again'", async () => {
    const originalError = console.error;
    console.error = () => {};

    const { fetchGrantBundle } = await import("../../lib/genlayerClient");
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByTestId("contract-address-input"), "0x1234567890123456789012345678901234567890");
    fireEvent.click(screen.getByTestId("tab-browse"));
    await user.type(screen.getByTestId("b-grant-id"), "g1");
    fireEvent.click(screen.getByTestId("load-grant-btn"));
    await screen.findByTestId("panel-error-boundary-browse");

    // Fix the underlying data, then retry -- the boundary should recover.
    fetchGrantBundle.mockResolvedValue({
      grant: { funder: "0xF", grantee: "0xG", project_description: "d", status: "active", milestones: [] },
      progress: {
        completed_milestones: 0, total_milestones: 0, progress_pct: 0,
        amount_released: 0, amount_remaining: 0, status: "active", pending_review: "",
      },
      results: {},
    });
    fireEvent.click(screen.getByText("Try again"));

    expect(screen.queryByTestId("panel-error-boundary-browse")).not.toBeInTheDocument();
    expect(screen.getByText("Grant & milestone browser")).toBeInTheDocument();

    console.error = originalError;
  });
});
