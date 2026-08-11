// src/components/GranteeSubmission.jsx
import { useMemo, useRef, useState } from "react";
import { useGrantOS } from "../context/GrantOSContext";
import { submitMilestone, waitForAccepted, waitForMilestoneResult, checkCallPreconditions } from "../lib/genlayerClient";
import Banner from "./Banner";

export default function GranteeSubmission() {
  const { client, account, contractAddress } = useGrantOS();

  const [grantId, setGrantId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [report, setReport] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [msg, setMsg] = useState({ text: "", kind: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Ref guard (synchronous, unlike state) against double-submitting a
  // transaction -- see the matching comment in FunderDashboard.jsx.
  const isSubmittingRef = useRef(false);

  const urlCount = useMemo(
    () => urlsText.split("\n").map((u) => u.trim()).filter(Boolean).length,
    [urlsText]
  );

  async function handleSubmit() {
    if (isSubmittingRef.current) return;
    setMsg({ text: "", kind: "" });
    const precheck = checkCallPreconditions({ contractAddress, account, requireWallet: true });
    if (precheck) {
      setMsg({ text: precheck, kind: "error" });
      return;
    }
    if (!grantId.trim() || !milestoneId.trim()) {
      setMsg({ text: "Grant ID and Milestone ID are required.", kind: "error" });
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const evidenceUrls = urlsText
        .split("\n")
        .map((u) => u.trim())
        .filter(Boolean)
        .slice(0, 5);

      setMsg({ text: "Submitting…", kind: "pending" });
      const txHash = await submitMilestone(client, contractAddress, {
        grantId,
        milestoneId,
        report,
        evidenceUrls,
      });
      setMsg({ text: `Submitted. Validators are evaluating your evidence. tx: ${txHash}`, kind: "pending" });
      await waitForAccepted(client, txHash);
      // The AI evaluation is non-deterministic (leader + validators). The
      // ACCEPTED receipt can arrive before the verdict is stored, so poll for
      // the actual result instead of claiming success prematurely.
      setMsg({ text: "Submitted. Waiting for the AI validators' verdict…", kind: "pending" });
      const result = await waitForMilestoneResult(client, contractAddress, grantId, milestoneId);
      if (!result) {
        setMsg({
          text: "Submitted and accepted on-chain. The AI verdict is still settling — check the Grant Browser tab shortly for the result.",
          kind: "ok",
        });
      } else {
        const verdict = result.final_status || result.llm_status || "recorded";
        setMsg({
          text: `Verification complete — verdict: ${verdict}. See the Grant Browser tab for the full evaluation.`,
          kind: "ok",
        });
      }
    } catch (err) {
      setMsg({ text: `Error: ${err.message}`, kind: "error" });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <section className="view">
      <div className="card">
        <h2>Submit milestone evidence</h2>
        <div className="hint">
          Milestones must be submitted in order. The next incomplete milestone in the sequence is the only one that will be accepted.
        </div>

        <div className="field">
          <label>Grant ID</label>
          <input data-testid="s-grant-id" value={grantId} onChange={(e) => setGrantId(e.target.value)} placeholder="grant id" />
        </div>
        <div className="field">
          <label>Milestone ID</label>
          <input data-testid="s-milestone-id" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} placeholder="e.g. M1" />
        </div>
        <div className="field">
          <label>Your report</label>
          <textarea data-testid="s-report" value={report} onChange={(e) => setReport(e.target.value)} placeholder="Describe what you completed for this milestone" />
        </div>
        <div className="field">
          <label>
            Evidence URLs (one per line, up to 5)
            <span className={`url-count ${urlCount > 5 ? "over" : ""}`}> · {Math.min(urlCount, 5)}/5</span>
          </label>
          <textarea
            data-testid="s-urls"
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            placeholder={"https://github.com/you/repo\nhttps://your-demo.example.com"}
          />
          {urlCount > 5 && <div className="hint hint-warn">Only the first 5 URLs will be submitted.</div>}
        </div>

        <button type="button" onClick={handleSubmit} data-testid="submit-milestone-btn" disabled={isSubmitting}>
          {isSubmitting ? "Submitting…" : "Submit for AI Verification"}
        </button>
        <Banner {...msg} testId="submit-msg" />
        {isSubmitting && (
          <div className="hint" data-testid="submit-pending">
            Validators are independently fetching your evidence and evaluating it — this can take a little while to finalize. Check the Grant Browser tab for the result.
          </div>
        )}
      </div>
    </section>
  );
}
