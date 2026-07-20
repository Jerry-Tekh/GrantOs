// src/App.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the funder dashboard by default", () => {
    render(<App />);
    expect(screen.getByText("Create a grant")).toBeInTheDocument();
  });

  it("switches to the grantee submission panel", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("tab-grantee"));
    expect(screen.getByText("Submit milestone evidence")).toBeInTheDocument();
  });

  it("switches to the grant browser panel", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("tab-browse"));
    expect(screen.getByText("Grant & milestone browser")).toBeInTheDocument();
  });

  it("shows the contract address input and connect button in the header on every tab", () => {
    render(<App />);
    expect(screen.getByTestId("contract-address-input")).toBeInTheDocument();
    expect(screen.getByTestId("connect-btn")).toHaveTextContent("Connect Wallet");
    fireEvent.click(screen.getByTestId("tab-browse"));
    expect(screen.getByTestId("contract-address-input")).toBeInTheDocument();
  });

  // Regression test for a real bug: panels used to be conditionally rendered
  // (one component swapped for another), which fully unmounted the inactive
  // tabs and silently wiped any in-progress form state on every tab switch.
  it("preserves in-progress form state across tab switches (regression: panels used to unmount)", () => {
    render(<App />);
    fireEvent.change(screen.getByTestId("grant-id-input"), { target: { value: "my-precious-grant-id" } });
    fireEvent.change(screen.getByTestId("description-input"), { target: { value: "Important draft text" } });

    fireEvent.click(screen.getByTestId("tab-grantee"));
    fireEvent.click(screen.getByTestId("tab-browse"));
    fireEvent.click(screen.getByTestId("tab-funder"));

    expect(screen.getByTestId("grant-id-input").value).toBe("my-precious-grant-id");
    expect(screen.getByTestId("description-input").value).toBe("Important draft text");
  });

  it("preserves a loaded Grant Browser result across tab switches", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("tab-browse"));
    fireEvent.change(screen.getByTestId("b-grant-id"), { target: { value: "some-grant-id" } });
    // (Load will error without a real contract/client -- that's fine, we're
    // only checking that the typed-in grant id itself survives navigation.)
    fireEvent.click(screen.getByTestId("tab-funder"));
    fireEvent.click(screen.getByTestId("tab-browse"));
    expect(screen.getByTestId("b-grant-id").value).toBe("some-grant-id");
  });
});
