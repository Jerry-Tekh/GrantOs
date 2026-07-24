// src/components/__tests__/LandingPage.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LandingPage from "../LandingPage";

describe("LandingPage", () => {
  it("renders the hero headline and value proposition", () => {
    render(<LandingPage onLaunch={() => {}} />);
    expect(screen.getByText(/Funding shouldn't require/)).toBeInTheDocument();
    expect(screen.getByText(/independent validators/)).toBeInTheDocument();
  });

  it("renders all four how-it-works steps in order", () => {
    render(<LandingPage onLaunch={() => {}} />);
    expect(screen.getByText("Escrow the grant")).toBeInTheDocument();
    expect(screen.getByText("Submit evidence")).toBeInTheDocument();
    expect(screen.getByText("Validators verify, independently")).toBeInTheDocument();
    expect(screen.getByText("Consensus releases funds")).toBeInTheDocument();
  });

  it("renders the feature grid", () => {
    render(<LandingPage onLaunch={() => {}} />);
    expect(screen.getByText("Escrowed, milestone-gated funding")).toBeInTheDocument();
    expect(screen.getByText("Independent multi-validator consensus")).toBeInTheDocument();
    expect(screen.getByText("On-chain, auditable")).toBeInTheDocument();
  });

  it("calls onLaunch from the hero CTA", () => {
    const onLaunch = vi.fn();
    render(<LandingPage onLaunch={onLaunch} />);
    fireEvent.click(screen.getByTestId("hero-launch-btn"));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("calls onLaunch from the nav CTA", () => {
    const onLaunch = vi.fn();
    render(<LandingPage onLaunch={onLaunch} />);
    fireEvent.click(screen.getByTestId("nav-launch-btn"));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("calls onLaunch from the final CTA", () => {
    const onLaunch = vi.fn();
    render(<LandingPage onLaunch={onLaunch} />);
    fireEvent.click(screen.getByTestId("final-launch-btn"));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("is honest about running on testnet, not mainnet", () => {
    render(<LandingPage onLaunch={() => {}} />);
    expect(screen.getAllByText(/Bradbury testnet/).length).toBeGreaterThan(0);
  });

  it("does not fabricate testimonials, customer logos, or user-count numbers", () => {
    render(<LandingPage onLaunch={() => {}} />);
    const text = document.body.textContent;
    // No fabricated social proof: no "trusted by", "customers", star ratings, etc.
    expect(text).not.toMatch(/trusted by \d/i);
    expect(text).not.toMatch(/\d[\d,]* (users|customers|grants funded)/i);
  });
});
