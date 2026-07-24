// src/components/LandingPage.jsx
import BrandMark from "./BrandMark";
import VerificationDiagram from "./VerificationDiagram";
import { EscrowMark, ConsensusMarkIcon, LedgerMark, HumanMark, SequenceMark, FeedbackMark } from "./FeatureIcons";

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className="compare-mark" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="#e1f2ee" />
      <path d="M4.5 8.2l2.2 2.2 4.8-5.4" stroke="#0f7b6c" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CrossMarkOld() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className="compare-mark" aria-hidden="true">
      <circle cx="8" cy="8" r="8" fill="#f2f3f5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#8b95a1" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const PROCESS_STEPS = [
  {
    title: "Escrow the grant",
    body: "The funder locks the full grant amount on-chain and defines each milestone's success criteria up front. Milestone amounts must sum to the total exactly -- the contract won't accept anything else.",
  },
  {
    title: "Submit evidence",
    body: "When a milestone is done, the grantee submits a short report plus evidence links -- a repo, a deployed demo, a transaction, whatever proves the work.",
  },
  {
    title: "Validators verify, independently",
    body: "Multiple validators each fetch the evidence and evaluate it against the milestone's stated criteria -- separately, without seeing each other's answer first.",
  },
  {
    title: "Consensus releases funds",
    body: "When validators agree the milestone is genuinely met, the tranche releases automatically. A low-confidence or split verdict routes to the funder for a final call -- never a silent auto-reject.",
  },
];

const FEATURES = [
  { Icon: EscrowMark, title: "Escrowed, milestone-gated funding", body: "Funds lock at grant creation and release only against a verified milestone -- never before, never all at once." },
  { Icon: ConsensusMarkIcon, title: "Independent multi-validator consensus", body: "No single validator's opinion is enough on its own -- the Equivalence Principle requires independent agreement." },
  { Icon: LedgerMark, title: "On-chain, auditable", body: "Every evaluation, quality score, and payout is a permanent public record -- not a spreadsheet or a private email thread." },
  { Icon: HumanMark, title: "Human override, not a black box", body: "A low-confidence or split verdict routes to the funder for a real decision -- the contract never quietly rejects on a hunch." },
  { Icon: SequenceMark, title: "Sequential milestones", body: "Milestones complete in order. A grantee can't skip ahead to a later tranche before earlier work is verified." },
  { Icon: FeedbackMark, title: "Specific, actionable feedback", body: "A rejected or partial submission comes back with the exact criteria that weren't met -- not just a thumbs-down." },
];

export default function LandingPage({ onLaunch }) {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <a className="brand-row" href="#top">
          <BrandMark size={30} />
          <span className="brand-word">GrantOS</span>
        </a>
        <div className="landing-nav-links">
          <div className="landing-nav-links-list">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <a href="#genlayer">Built on GenLayer</a>
          </div>
          <button type="button" className="btn btn-primary" onClick={onLaunch} data-testid="nav-launch-btn">
            Launch App
          </button>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">GenLayer Intelligent Contract · Milestone Verification</span>
          <h1>
            Funding shouldn't require <em>blind trust.</em>
          </h1>
          <p className="hero-sub">
            GrantOS escrows a grant's funds on-chain and releases each milestone only after independent validators
            verify the evidence -- and agree. No committee delays, no unilateral judgment calls, no funds released on
            a hunch.
          </p>
          <div className="hero-ctas">
            <button type="button" className="btn btn-primary btn-lg" onClick={onLaunch} data-testid="hero-launch-btn">
              Launch the app
            </button>
            <a className="btn btn-secondary btn-lg" href="#how-it-works">
              See how verification works
            </a>
          </div>
        </div>
        <VerificationDiagram />
      </header>

      <section className="section section-narrow">
        <div className="section-head centered">
          <span className="eyebrow">The problem</span>
          <h2>Grant milestone review is still a manual bottleneck.</h2>
        </div>
        <div className="compare-grid">
          <div className="compare-card old">
            <h3>The old way</h3>
            <ul className="compare-list">
              <li><CrossMarkOld />A single reviewer's subjective judgment call decides everything.</li>
              <li><CrossMarkOld />Milestone reports sit in an inbox for weeks before anyone looks.</li>
              <li><CrossMarkOld />No public record of why a milestone was approved or rejected.</li>
              <li><CrossMarkOld />Funds move (or don't) with no audit trail.</li>
            </ul>
          </div>
          <div className="compare-card new">
            <h3>The GrantOS way</h3>
            <ul className="compare-list">
              <li><CheckMark />Multiple validators independently verify the same evidence.</li>
              <li><CheckMark />Consensus triggers an automatic release -- no waiting on a calendar.</li>
              <li><CheckMark />Every quality score and verdict is a permanent, public, on-chain record.</li>
              <li><CheckMark />Disagreement routes to a human -- it never disappears silently.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>Four steps, from escrow to payout.</h2>
        </div>
        <div className="process-list">
          {PROCESS_STEPS.map((step, i) => (
            <div className="process-step" key={step.title}>
              <div className="process-num">{String(i + 1).padStart(2, "0")}</div>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-head centered">
          <span className="eyebrow">What's actually in the contract</span>
          <h2>Every feature here maps to real, tested contract logic.</h2>
          <p>Nothing on this page is aspirational -- it's what grantos.py actually enforces on-chain.</p>
        </div>
        <div className="features-grid">
          {FEATURES.map(({ Icon, title, body }) => (
            <div className="feature-card" key={title}>
              <Icon />
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="genlayer">
        <div className="tech-panel">
          <div>
            <span className="eyebrow" style={{ color: "#5fd9c4" }}>Built on GenLayer</span>
            <h2>AI can read evidence. Consensus makes it trustworthy.</h2>
            <p>
              GrantOS runs as an Intelligent Contract on GenLayer -- a network where validators can browse the web and
              reason about what they find, then must agree with each other before a transaction finalizes. That's
              what makes AI-driven milestone verification safe to put in charge of real funds.
            </p>
          </div>
          <div className="tech-facts">
            <div className="tech-fact">
              <div className="tech-fact-label">Optimistic Democracy</div>
              <div className="tech-fact-body">Validators vote on the outcome of non-deterministic operations like web reads and LLM calls, the same way they'd vote on any other transaction.</div>
            </div>
            <div className="tech-fact">
              <div className="tech-fact-label">Equivalence Principle</div>
              <div className="tech-fact-body">Validators don't need identical output -- they need outcomes that agree within defined tolerance, which is exactly how GrantOS compares quality scores and criteria.</div>
            </div>
            <div className="tech-fact">
              <div className="tech-fact-label">Currently on Bradbury testnet</div>
              <div className="tech-fact-body">GrantOS is deployed and tested against GenLayer's Bradbury testnet today.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <span className="eyebrow">Ready when you are</span>
        <h2>Escrow a grant, or submit your next milestone.</h2>
        <p>Connect a wallet, point it at a deployed GrantOS contract, and see the whole flow for yourself.</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={onLaunch} data-testid="final-launch-btn">
          Launch the app
        </button>
        <div className="testnet-note">Running on GenLayer's Bradbury testnet -- not mainnet funds.</div>
      </section>

      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <BrandMark size={24} />
            <span>GrantOS</span>
          </div>
          <div className="footer-links">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <a href="#genlayer">Built on GenLayer</a>
            <a href="https://genlayer.com" target="_blank" rel="noreferrer">GenLayer</a>
          </div>
          <div className="footer-meta">GenLayer Bradbury Testnet</div>
        </div>
      </footer>
    </div>
  );
}
