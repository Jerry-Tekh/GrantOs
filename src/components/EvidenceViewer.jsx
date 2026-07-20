// src/components/EvidenceViewer.jsx
import StatusPill from "./StatusPill";

/**
 * Renders a milestone's evidence result: criteria met/not-met on one side,
 * the AI verdict (quality score + status + feedback) on the other.
 * `result` is the object returned by get_milestone_result().
 */
export default function EvidenceViewer({ milestoneId, result }) {
  if (!result || !result.final_status) {
    return <div className="hint">No submission yet for {milestoneId}.</div>;
  }

  const criteriaMet = result.criteria_met || [];
  const criteriaNotMet = result.criteria_not_met || [];

  return (
    <div className="evidence-viewer" data-testid={`evidence-viewer-${milestoneId}`}>
      <div className="col">
        <h3>Criteria met</h3>
        <ul>
          {criteriaMet.length > 0
            ? criteriaMet.map((c, i) => <li key={i} className="criteria-met">✓ {c}</li>)
            : <li>—</li>}
        </ul>
        <h3>Criteria not met</h3>
        <ul>
          {criteriaNotMet.length > 0
            ? criteriaNotMet.map((c, i) => <li key={i} className="criteria-not-met">✗ {c}</li>)
            : <li>—</li>}
        </ul>
      </div>
      <div className="col">
        <h3>AI verdict</h3>
        <div className="verdict-box">
          <div className="score">
            {result.quality_score}
            <span className="score-suffix">/100</span>
          </div>
          <StatusPill status={result.final_status} />
          {result.llm_status !== result.final_status && (
            <span className="hint hint-inline"> (raw LLM verdict: {result.llm_status})</span>
          )}
          <div className="feedback-text">&ldquo;{result.feedback}&rdquo;</div>
        </div>
      </div>
    </div>
  );
}
