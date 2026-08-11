// src/components/FunderDashboard.jsx
import { useMemo, useRef, useState } from "react";
import { useGrantOS } from "../context/GrantOSContext";
import {
  createGrant,
  waitForAccepted,
  waitForGrantVisible,
  validateMilestoneAmounts,
  fetchGrantBundle,
  resolvePendingReview,
  checkCallPreconditions,
  formatAmount,
  formatInputAmount,
  isValidAddress,
} from "../lib/genlayerClient";
import EvidenceViewer from "./EvidenceViewer";
import StatusPill from "./StatusPill";
import Banner from "./Banner";

const DEFAULT_MILESTONES = [
  { id: "M1", title: "Deploy contract", criteria: "Contract deployed on Bradbury, verifiable on-chain", amount: "" },
  { id: "M2", title: "Frontend live", criteria: "Frontend deployed and demoable end-to-end", amount: "" },
];

export default function FunderDashboard() {
  // `client` works for read calls even with no wallet connected (it's a
  // read-only client by default) -- only `account` tells us whether a wallet
  // is actually connected, which is what writes require.
  const { client, account, contractAddress } = useGrantOS();

  const [grantId, setGrantId] = useState("");
  const [grantee, setGrantee] = useState("");
  const [description, setDescription] = useState("");
  const [milestones, setMilestones] = useState(DEFAULT_MILESTONES);
  const [totalAmount, setTotalAmount] = useState("");
  const [createMsg, setCreateMsg] = useState({ text: "", kind: "" });
  const [isCreating, setIsCreating] = useState(false);

  const [reviewGrantId, setReviewGrantId] = useState("");
  const [reviewBundle, setReviewBundle] = useState(null);
  const [reviewMsg, setReviewMsg] = useState({ text: "", kind: "" });
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  // Ref guards (checked synchronously, unlike state) as defense-in-depth
  // against double-submitting a transaction -- the disabled-state on each
  // button already covers the common case, but relies on React having
  // flushed a re-render before a second click lands, which isn't guaranteed
  // on every platform (e.g. some mobile browsers can fire two synthetic
  // click events from a single fast tap before that flush happens). A
  // duplicate submit here isn't just a UI glitch -- it's a second on-chain
  // transaction and wasted gas.
  const isCreatingRef = useRef(false);
  const isResolvingRef = useRef(false);

  function updateMilestone(index, field, value) {
    setMilestones((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  }
  function addMilestone() {
    setMilestones((prev) => [...prev, { id: "", title: "", criteria: "", amount: "" }]);
  }
  function removeMilestone(index) {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  // Live feedback as the funder types, before they ever click submit --
  // mirrors the contract's exact-sum assert so the mismatch is obvious early.
  const liveSum = useMemo(
    () => milestones.reduce((s, m) => s + (Number.isFinite(Number(m.amount)) ? Number(m.amount) : 0), 0),
    [milestones]
  );
  const liveTotal = Number(totalAmount || 0);
  const sumMatches = milestones.length > 0 && liveSum === liveTotal;

  async function handleCreateGrant() {
    if (isCreatingRef.current) return;
    setCreateMsg({ text: "", kind: "" });
    const precheck = checkCallPreconditions({ contractAddress, account, requireWallet: true });
    if (precheck) {
      setCreateMsg({ text: precheck, kind: "error" });
      return;
    }
    isCreatingRef.current = true;
    setIsCreating(true);
    try {
      if (!isValidAddress(grantee)) {
        throw new Error("Grantee wallet address isn't valid -- it should be 0x followed by 40 hex characters.");
      }
      const cleaned = milestones
        .filter((m) => m.id.trim())
        .map((m) => ({ ...m, amount: m.amount.trim() }));

      // Parse totalAmount exactly once and validate it explicitly here --
      // this used to be parsed a second time later with a different (missing)
      // fallback, so a blank field could pass validation as an implicit 0
      // but then reach BigInt(NaN) in createGrant() when milestones also
      // summed to 0, crashing with a confusing raw JS error instead of a
      // clear message. Confirmed concretely before this fix: a blank total
      // amount field genuinely produced `totalAmount: NaN` reaching the
      // write call.
      if (!totalAmount.trim()) {
        throw new Error("Enter a total amount.");
      }

      const check = validateMilestoneAmounts(cleaned, totalAmount);
      if (!check.valid) throw new Error(check.error);

      setCreateMsg({ text: "Submitting transaction…", kind: "pending" });
      const txHash = await createGrant(client, contractAddress, {
        grantId,
        grantee,
        description,
        milestones: cleaned,
        totalAmount,
      });
      setCreateMsg({ text: `Waiting for consensus… tx: ${txHash}`, kind: "pending" });
      await waitForAccepted(client, txHash);
      // A write reaches ACCEPTED a few seconds before a view call can read the
      // new state. Confirm the grant is actually readable before claiming
      // success, so the funder's very next "Load Grant" finds it instead of
      // erroring — the exact bug this dashboard had.
      setCreateMsg({ text: "Confirming the grant is readable on-chain…", kind: "pending" });
      const visible = await waitForGrantVisible(client, contractAddress, grantId);
      setReviewGrantId(grantId);
      if (visible) {
        setCreateMsg({ text: "Grant created and funded. Loading it below…", kind: "ok" });
        await handleLoadReview(grantId);
      } else {
        setCreateMsg({
          text: "Grant created and funded, but it's taking a moment to become readable. Click \"Load Grant\" below in a few seconds.",
          kind: "ok",
        });
      }
    } catch (err) {
      setCreateMsg({ text: `Error: ${err.message}`, kind: "error" });
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  }

  async function handleLoadReview(idArg) {
    // Called both from the button onClick (receives a click event) and
    // programmatically right after create (receives the grant id string).
    const lookupId = typeof idArg === "string" ? idArg : reviewGrantId;
    setReviewMsg({ text: "", kind: "" });
    setReviewBundle(null);
    // Reading a grant's state is a public view call -- it doesn't need a
    // connected wallet, only a valid contract address to read from.
    const precheck = checkCallPreconditions({ contractAddress, account, requireWallet: false });
    if (precheck) {
      setReviewMsg({ text: precheck, kind: "error" });
      return;
    }
    if (!lookupId.trim()) {
      setReviewMsg({ text: "Enter a grant ID to look up.", kind: "error" });
      return;
    }
    setIsLoadingReview(true);
    try {
      const bundle = await fetchGrantBundle(client, contractAddress, lookupId);
      setReviewBundle(bundle);
    } catch {
      // A read error here is almost always a grant that doesn't exist (or has
      // not become readable yet). The raw contract error is an unreadable hex
      // dump, so show a plain-language message instead.
      setReviewMsg({
        text: `Couldn't load grant "${lookupId}". Check the ID is correct — if you just created it, wait a few seconds and try again.`,
        kind: "error",
      });
    } finally {
      setIsLoadingReview(false);
    }
  }

  async function handleResolve(approve) {
    if (isResolvingRef.current) return;
    setReviewMsg({ text: "", kind: "" });
    const precheck = checkCallPreconditions({ contractAddress, account, requireWallet: true });
    if (precheck) {
      setReviewMsg({ text: precheck, kind: "error" });
      return;
    }
    isResolvingRef.current = true;
    setIsResolving(true);
    setReviewMsg({ text: "Submitting…", kind: "pending" });
    try {
      const milestoneId = reviewBundle.progress.pending_review;
      const txHash = await resolvePendingReview(client, contractAddress, {
        grantId: reviewGrantId,
        milestoneId,
        approve,
      });
      await waitForAccepted(client, txHash);
      setReviewMsg({ text: approve ? "Approved — funds released." : "Rejected.", kind: "ok" });
      const bundle = await fetchGrantBundle(client, contractAddress, reviewGrantId);
      setReviewBundle(bundle);
    } catch (err) {
      setReviewMsg({ text: `Error: ${err.message}`, kind: "error" });
    } finally {
      isResolvingRef.current = false;
      setIsResolving(false);
    }
  }

  const pendingMilestone =
    reviewBundle?.progress?.pending_review &&
    reviewBundle.grant.milestones.find((m) => m.id === reviewBundle.progress.pending_review);

  return (
    <section className="view">
      <div className="card">
        <h2>Create a grant</h2>
        <div className="hint">
          Escrows GEN for the total amount. Milestone amounts must sum to the total exactly, or the transaction reverts.
        </div>

        <div className="field">
          <label>Grant ID</label>
          <input data-testid="grant-id-input" value={grantId} onChange={(e) => setGrantId(e.target.value)} placeholder="e.g. grantos-self-fund" />
        </div>
        <div className="field">
          <label>Grantee wallet address</label>
          <input data-testid="grantee-input" value={grantee} onChange={(e) => setGrantee(e.target.value)} placeholder="0x…" />
        </div>
        <div className="field">
          <label>Project description</label>
          <textarea data-testid="description-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this grant funding?" />
        </div>

        <div className="field">
          <label>Milestones</label>
          {milestones.map((m, i) => (
            <div className="milestone-row" key={i}>
              <input data-testid={`m-id-${i}`} placeholder="ID (M1)" value={m.id} onChange={(e) => updateMilestone(i, "id", e.target.value)} />
              <input data-testid={`m-title-${i}`} placeholder="Title" value={m.title} onChange={(e) => updateMilestone(i, "title", e.target.value)} />
              <input data-testid={`m-criteria-${i}`} placeholder="Success criteria" value={m.criteria} onChange={(e) => updateMilestone(i, "criteria", e.target.value)} />
              <input data-testid={`m-amount-${i}`} placeholder="Amount" type="number" min="0" step="any" value={m.amount} onChange={(e) => updateMilestone(i, "amount", e.target.value)} />
              <button type="button" className="remove-m" onClick={() => removeMilestone(i)} aria-label={`Remove milestone ${i + 1}`}>×</button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={addMilestone} data-testid="add-milestone-btn">
            + Add milestone
          </button>
        </div>

        <div className="field">
          <label>Total amount</label>
          <div className="input-with-suffix">
            <input data-testid="total-amount-input" type="number" min="0" step="any" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="1000" />
            <span className="input-suffix">GEN</span>
          </div>
        </div>

        {(liveSum > 0 || liveTotal > 0) && (
          <div className={`sum-indicator ${sumMatches ? "match" : "mismatch"}`} data-testid="sum-indicator">
            <span className="sum-indicator-dot" />
            Milestones sum to <strong>{formatInputAmount(liveSum)}</strong> · total is <strong>{formatInputAmount(liveTotal)}</strong>
            {sumMatches ? " — matches" : " — must match exactly"}
          </div>
        )}

        <button type="button" onClick={handleCreateGrant} data-testid="create-grant-btn" disabled={isCreating} className={isCreating ? "is-loading" : ""}>
          {isCreating ? "Submitting…" : "Create Grant & Escrow Funds"}
        </button>
        <Banner {...createMsg} testId="create-grant-msg" />
      </div>

      <div className="card">
        <h2>Grants you funded — pending reviews</h2>
        <div className="hint">Look up a grant by ID to resolve any milestone flagged "partial" by the AI evaluator.</div>
        <div className="field">
          <label>Grant ID</label>
          <input data-testid="review-grant-id-input" value={reviewGrantId} onChange={(e) => setReviewGrantId(e.target.value)} placeholder="grant id" />
        </div>
        <button type="button" className="secondary" onClick={handleLoadReview} data-testid="load-review-btn" disabled={isLoadingReview}>
          {isLoadingReview ? "Loading…" : "Load Grant"}
        </button>

        {reviewBundle && (
          <div className="card grant-card" data-testid="review-grant-summary">
            <div className="review-card-head">
              <strong>{reviewGrantId}</strong>
              {reviewBundle.grant?.status && <StatusPill status={reviewBundle.grant.status} />}
            </div>
            {reviewBundle.grant?.grantee && (
              <div className="hint">Grantee: {reviewBundle.grant.grantee}</div>
            )}
            {reviewBundle.grant?.project_description && (
              <div className="hint">{reviewBundle.grant.project_description}</div>
            )}
            {reviewBundle.progress && (
              <div className="hint">
                {reviewBundle.progress.completed_milestones ?? 0}/{reviewBundle.progress.total_milestones ?? (reviewBundle.grant?.milestones?.length ?? 0)} milestones complete
                {reviewBundle.progress.amount_released !== undefined && (
                  <> · {formatAmount(reviewBundle.progress.amount_released)} released / {formatAmount(reviewBundle.progress.amount_remaining)} remaining</>
                )}
              </div>
            )}
            {reviewBundle.grant?.milestones?.length > 0 && (
              <ul className="milestone-mini-list">
                {reviewBundle.grant.milestones.map((m) => (
                  <li key={m.id} data-testid={`review-milestone-${m.id}`}>
                    <span><strong>{m.id}</strong> — {m.title} · {formatAmount(m.amount)} GEN</span>
                    <StatusPill status={reviewBundle.results?.[m.id]?.final_status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {reviewBundle && !pendingMilestone && (
          <div className="empty">No milestone pending review on this grant.</div>
        )}

        {pendingMilestone && (
          <div className="card review-card" data-testid="pending-review-card">
            <div className="review-card-head">
              <strong>{pendingMilestone.id} — {pendingMilestone.title}</strong>
              <StatusPill status={reviewBundle.results[pendingMilestone.id]?.final_status} />
            </div>
            <div className="hint">{formatAmount(pendingMilestone.amount)} GEN at stake</div>
            <EvidenceViewer milestoneId={pendingMilestone.id} result={reviewBundle.results[pendingMilestone.id]} />
            <div className="resolve-actions">
              <button type="button" onClick={() => handleResolve(true)} data-testid="approve-btn" disabled={isResolving}>
                {isResolving ? "Submitting…" : "Approve & Release Funds"}
              </button>
              <button type="button" className="danger" onClick={() => handleResolve(false)} data-testid="reject-btn" disabled={isResolving}>
                Reject
              </button>
            </div>
          </div>
        )}
        <Banner {...reviewMsg} testId="review-msg" />
      </div>
    </section>
  );
}
