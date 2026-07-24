// src/components/FeatureIcons.jsx
// Small original line marks, one per real mechanism in the contract -- not
// generic stock icons. Kept simple/geometric so they don't compete with the
// hero verification diagram, which is the one bold signature moment.

export function EscrowMark() {
  return (
    <svg viewBox="0 0 38 38" fill="none" className="feature-mark">
      <rect x="6" y="16" width="26" height="17" rx="3" stroke="#0f7b6c" strokeWidth="2" />
      <path d="M12 16v-3a7 7 0 0 1 14 0v3" stroke="#0f7b6c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="19" cy="24.5" r="2.4" fill="#0f7b6c" />
    </svg>
  );
}

export function ConsensusMarkIcon() {
  return (
    <svg viewBox="0 0 38 38" fill="none" className="feature-mark">
      <circle cx="9" cy="10" r="3" stroke="#0f7b6c" strokeWidth="2" />
      <circle cx="29" cy="10" r="3" stroke="#0f7b6c" strokeWidth="2" />
      <circle cx="19" cy="6" r="3" stroke="#0f7b6c" strokeWidth="2" />
      <path d="M9 10L19 26L29 10M19 6V26" stroke="#0f7b6c" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="19" cy="30" r="5.5" fill="#0f7b6c" />
      <path d="M16.3 30.1l2 2 3.3-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LedgerMark() {
  return (
    <svg viewBox="0 0 38 38" fill="none" className="feature-mark">
      <rect x="7" y="5" width="24" height="28" rx="2.5" stroke="#0f7b6c" strokeWidth="2" />
      <path d="M13 13h12M13 19h12M13 25h7" stroke="#0f7b6c" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HumanMark() {
  return (
    <svg viewBox="0 0 38 38" fill="none" className="feature-mark">
      <circle cx="19" cy="12" r="6" stroke="#0f7b6c" strokeWidth="2" />
      <path d="M7 33c0-7 5-11 12-11s12 4 12 11" stroke="#0f7b6c" strokeWidth="2" strokeLinecap="round" />
      <path d="M27 8l4 4-4 4" stroke="#b8862e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SequenceMark() {
  return (
    <svg viewBox="0 0 38 38" fill="none" className="feature-mark">
      <circle cx="8" cy="19" r="4" fill="#0f7b6c" />
      <circle cx="19" cy="19" r="4" stroke="#0f7b6c" strokeWidth="2" />
      <circle cx="30" cy="19" r="4" stroke="#c9d0d8" strokeWidth="2" />
      <path d="M12 19h3M23 19h3" stroke="#c9d0d8" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function FeedbackMark() {
  return (
    <svg viewBox="0 0 38 38" fill="none" className="feature-mark">
      <path d="M7 9h24v16H16l-5 5v-5H7z" stroke="#0f7b6c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 15h12M13 20h8" stroke="#0f7b6c" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
