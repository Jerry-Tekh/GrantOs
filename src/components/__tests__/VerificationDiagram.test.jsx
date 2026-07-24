// src/components/__tests__/VerificationDiagram.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VerificationDiagram from "../VerificationDiagram";

describe("VerificationDiagram", () => {
  it("renders all four real stages of the mechanism, in order", () => {
    render(<VerificationDiagram />);
    const labels = screen.getAllByText(
      /Evidence submitted|Validators verify independently|Consensus reached|Funds released automatically/
    );
    expect(labels.map((l) => l.textContent)).toEqual([
      "Evidence submitted",
      "Validators verify independently",
      "Consensus reached",
      "Funds released automatically",
    ]);
  });

  it("has an accessible text description of the mechanism for screen readers", () => {
    render(<VerificationDiagram />);
    expect(screen.getByRole("img", { name: /evidence is submitted/i })).toBeInTheDocument();
  });
});
