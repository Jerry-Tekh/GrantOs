// src/components/GrantBrowser.jsx
import { useState } from "react";
import { useGrantOS } from "../context/GrantOSContext";
import { fetchGrantBundle, checkCallPreconditions, formatAmount } from "../lib/genlayerClient";
import EvidenceViewer from "./EvidenceViewer";
import StatusPill from "./StatusPill";

function GrantSkeleton() {
  return (
    <div data-testid="grant-skeleton">
      <div className="card grant-card skeleton">
        <div className="skel-line skel-title" />
        <div className="skel-line skel-meta" />
        <div className="skel-bar" />
      </div>
      <div className="card skeleton">
        <div className="skel-line skel-title" />
        <div className="skel-line" />
      </div>
    </div>
  );
}

export default function GrantBrowser() {
  // Reading a grant is a public view call and needs no connected wallet --
  // only client (works read-only by default) and a contract address.
  const { client, contractAddress } = useGrantOS();
  const [grantId, setGrantId] = useState("");
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleLoad() {
    setError(null);
    const precheck = checkCallPreconditions({ contractAddress, account: null, requireWallet: false });
    if (precheck) {
      setError(precheck);
      return;
    }
    if (!grantId.trim()) {
      setError("Enter a grant ID to look up.");
      return;
    }
    setBundle(null);
    setLoading(true);
    try {
      const result = await fetchGrantBundle(client, contractAddress, grantId);
      setBundle(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="view">
      <div className="card">
        <h2>Grant &amp; milestone browser</h2>
        <div className="field">
          <label>Grant ID</label>
          <input data-testid="b-grant-id" value={grantId} onChange={(e) => setGrantId(e.target.value)} placeholder="grant id" />
        </div>
        <button type="button" className="secondary" onClick={handleLoad} data-testid="load-grant-btn" disabled={loading}>
          {loading ? "Loading…" : "Load Grant"}
        </button>
      </div>

      {loading && <GrantSkeleton />}
      {error && <div className="msg msg-error" data-testid="browse-error"><span className="msg-icon">⚠</span>Error: {error}</div>}

      {bundle && !loading && (
        <div data-testid="grant-detail">
          <div className={`card grant-card ${bundle.progress.pending_review ? "pending" : ""}`}>
            <h2>{grantId}</h2>
            <div className="grant-meta">
              Funder: {bundle.grant.funder} &middot; Grantee: {bundle.grant.grantee}
              <br />
              {bundle.grant.project_description}
            </div>
            <div className="progress-bar">
              <div style={{ width: `${bundle.progress.progress_pct}%` }} data-testid="progress-fill" />
            </div>
            <div className="hint">
              {bundle.progress.completed_milestones}/{bundle.progress.total_milestones} milestones complete &middot;{" "}
              {formatAmount(bundle.progress.amount_released)} released / {formatAmount(bundle.progress.amount_remaining)} remaining &middot; status:{" "}
              {bundle.grant.status}
              {bundle.progress.pending_review && (
                <>
                  {" "}
                  &middot; <strong className="pending-label">pending review: {bundle.progress.pending_review}</strong>
                </>
              )}
            </div>
          </div>

          {bundle.grant.milestones.map((m) => (
            <div className="card" key={m.id} data-testid={`milestone-card-${m.id}`}>
              <div className="milestone-card-head">
                <strong>{m.id} — {m.title}</strong>
                <StatusPill status={bundle.results[m.id]?.final_status} />
              </div>
              <div className="hint">{m.criteria} &middot; {formatAmount(m.amount)} GEN</div>
              <EvidenceViewer milestoneId={m.id} result={bundle.results[m.id]} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
