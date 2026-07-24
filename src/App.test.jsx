// src/App.test.jsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  window.location.hash = "";
});

function enterApp() {
  render(<App />);
  fireEvent.click(screen.getByTestId("hero-launch-btn"));
}

describe("App — landing page", () => {
  it("shows the landing page by default, not the app", () => {
    render(<App />);
    expect(screen.getByText(/Funding shouldn't require/)).toBeInTheDocument();
    expect(screen.queryByTestId("tab-funder")).not.toBeInTheDocument();
  });

  it("launches the app from the hero CTA", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("hero-launch-btn"));
    expect(screen.getByTestId("tab-funder")).toBeInTheDocument();
  });

  it("launches the app from the nav CTA", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("nav-launch-btn"));
    expect(screen.getByTestId("tab-funder")).toBeInTheDocument();
  });

  it("launches the app from the final CTA", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("final-launch-btn"));
    expect(screen.getByTestId("tab-funder")).toBeInTheDocument();
  });

  it("going directly to #app shows the app shell (deep link / bookmark support)", () => {
    window.location.hash = "app";
    render(<App />);
    expect(screen.getByTestId("tab-funder")).toBeInTheDocument();
  });

  it("responds to the browser back button via hashchange", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("hero-launch-btn"));
    expect(screen.getByTestId("tab-funder")).toBeInTheDocument();

    window.location.hash = "";
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.queryByTestId("tab-funder")).not.toBeInTheDocument();
    expect(screen.getByText(/Funding shouldn't require/)).toBeInTheDocument();
  });
});

describe("App — app shell (after launching)", () => {
  it("renders the funder dashboard by default once launched", () => {
    enterApp();
    expect(screen.getByText("Create a grant")).toBeInTheDocument();
  });

  it("switches to the grantee submission panel", () => {
    enterApp();
    fireEvent.click(screen.getByTestId("tab-grantee"));
    expect(screen.getByText("Submit milestone evidence")).toBeInTheDocument();
  });

  it("switches to the grant browser panel", () => {
    enterApp();
    fireEvent.click(screen.getByTestId("tab-browse"));
    expect(screen.getByText("Grant & milestone browser")).toBeInTheDocument();
  });

  it("shows the contract address input, connect button, and a way back to the site on every tab", () => {
    enterApp();
    expect(screen.getByTestId("contract-address-input")).toBeInTheDocument();
    expect(screen.getByTestId("connect-btn")).toHaveTextContent("Connect Wallet");
    expect(screen.getByTestId("back-to-site-link")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-browse"));
    expect(screen.getByTestId("contract-address-input")).toBeInTheDocument();
  });

  // Regression test for a real bug: panels used to be conditionally rendered
  // (one component swapped for another), which fully unmounted the inactive
  // tabs and silently wiped any in-progress form state on every tab switch.
  it("preserves in-progress form state across tab switches (regression: panels used to unmount)", () => {
    enterApp();
    fireEvent.change(screen.getByTestId("grant-id-input"), { target: { value: "my-precious-grant-id" } });
    fireEvent.change(screen.getByTestId("description-input"), { target: { value: "Important draft text" } });

    fireEvent.click(screen.getByTestId("tab-grantee"));
    fireEvent.click(screen.getByTestId("tab-browse"));
    fireEvent.click(screen.getByTestId("tab-funder"));

    expect(screen.getByTestId("grant-id-input").value).toBe("my-precious-grant-id");
    expect(screen.getByTestId("description-input").value).toBe("Important draft text");
  });

  it("preserves a loaded Grant Browser result across tab switches", async () => {
    enterApp();
    fireEvent.click(screen.getByTestId("tab-browse"));
    fireEvent.change(screen.getByTestId("b-grant-id"), { target: { value: "some-grant-id" } });
    // (Load will error without a real contract/client -- that's fine, we're
    // only checking that the typed-in grant id itself survives navigation.)
    fireEvent.click(screen.getByTestId("tab-funder"));
    fireEvent.click(screen.getByTestId("tab-browse"));
    expect(screen.getByTestId("b-grant-id").value).toBe("some-grant-id");
  });
});
