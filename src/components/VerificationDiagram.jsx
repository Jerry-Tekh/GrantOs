// src/components/VerificationDiagram.jsx

function EvidenceIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="8" y="4" width="24" height="32" rx="2" fill="#fff" stroke="#e4e7ec" strokeWidth="1.5" />
      <rect x="13" y="12" width="14" height="2" rx="1" fill="#c9d0d8" />
      <rect x="13" y="17" width="14" height="2" rx="1" fill="#c9d0d8" />
      <rect x="13" y="22" width="9" height="2" rx="1" fill="#c9d0d8" />
    </svg>
  );
}

function ValidatorTrio() {
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden="true">
      <circle className="vd-node vd-node-1" cx="10" cy="8" r="6" fill="#e1f2ee" stroke="#0f7b6c" strokeWidth="1.6" />
      <path className="vd-node vd-node-1" d="M7.4 8.2l1.7 1.7 3-3.4" stroke="#0f7b6c" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="vd-node vd-node-2" cx="28" cy="20" r="6" fill="#e1f2ee" stroke="#0f7b6c" strokeWidth="1.6" />
      <path className="vd-node vd-node-2" d="M25.4 20.2l1.7 1.7 3-3.4" stroke="#0f7b6c" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="vd-node vd-node-3" cx="46" cy="32" r="6" fill="#e1f2ee" stroke="#0f7b6c" strokeWidth="1.6" />
      <path className="vd-node vd-node-3" d="M43.4 32.2l1.7 1.7 3-3.4" stroke="#0f7b6c" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConsensusMark() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
      <circle className="vd-pulse" cx="26" cy="26" r="24" fill="none" stroke="#0f7b6c" strokeWidth="1.5" />
      <circle className="vd-consensus" cx="26" cy="26" r="18" fill="#0f7b6c" />
      <path className="vd-consensus" d="M18 26.5l5.5 5.5L34.5 20" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EscrowIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="7" y="16" width="26" height="18" rx="3" fill="#f7ecd9" stroke="#b8862e" strokeWidth="1.5" />
      <path d="M13 16v-3a7 7 0 0 1 14 0" fill="none" stroke="#b8862e" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="25" r="3.2" fill="#b8862e" />
    </svg>
  );
}

function Connector({ delayClass }) {
  return (
    <svg width="48" height="4" viewBox="0 0 48 4" className="vd-connector" aria-hidden="true">
      <line className={`vd-line ${delayClass}`} x1="2" y1="2" x2="46" y2="2" stroke="#c9d0d8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STAGES = [
  { Icon: EvidenceIcon, label: "Evidence submitted" },
  { Icon: ValidatorTrio, label: "Validators verify independently" },
  { Icon: ConsensusMark, label: "Consensus reached" },
  { Icon: EscrowIcon, label: "Funds released automatically" },
];

export default function VerificationDiagram() {
  return (
    <div className="verify-diagram-wrap">
      <div
        className="verify-diagram"
        role="img"
        aria-label="Diagram: evidence is submitted, multiple validators verify it independently, they reach consensus, and funds release automatically"
      >
        <div className="vd-stages">
          {STAGES.map(({ Icon, label }, i) => (
            <div className="vd-stage-group" key={label}>
              <div className="vd-stage">
                <div className="vd-icon"><Icon /></div>
                <div className="vd-label">{label}</div>
              </div>
              {i < STAGES.length - 1 && (
                <div className="vd-connector-wrap">
                  <Connector delayClass={`vd-line-${i + 1}`} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
