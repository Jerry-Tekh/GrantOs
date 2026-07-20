// src/components/__tests__/EvidenceViewer.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EvidenceViewer from "../EvidenceViewer";

describe("EvidenceViewer", () => {
  it("shows a 'no submission yet' message when there is no result", () => {
    render(<EvidenceViewer milestoneId="M1" result={{}} />);
    expect(screen.getByText(/No submission yet for M1/)).toBeInTheDocument();
  });

  it("renders criteria met/not-met and the AI verdict side by side", () => {
    render(
      <EvidenceViewer
        milestoneId="M1"
        result={{
          final_status: "completed",
          llm_status: "completed",
          quality_score: 85,
          criteria_met: ["deployed contract", "verified on explorer"],
          criteria_not_met: [],
          feedback: "Looks solid.",
        }}
      />
    );
    expect(screen.getByText(/deployed contract/)).toBeInTheDocument();
    expect(screen.getByText(/verified on explorer/)).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText(/Looks solid/)).toBeInTheDocument();
  });

  it("surfaces when the raw LLM verdict was downgraded by the quality-threshold gate", () => {
    render(
      <EvidenceViewer
        milestoneId="M1"
        result={{
          final_status: "partial",
          llm_status: "completed",
          quality_score: 55,
          criteria_met: [],
          criteria_not_met: ["quality too low"],
          feedback: "Needs more polish.",
        }}
      />
    );
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText(/raw LLM verdict: completed/)).toBeInTheDocument();
  });
});
