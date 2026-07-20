// src/components/BrandMark.jsx

/**
 * Same visual language as public/favicon.svg (dark moss square, cream ledger
 * page, moss checkmark, amber accent) so the header and the browser tab
 * icon read as the same brand rather than a plain text wordmark with an
 * unrelated favicon.
 */
export default function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="brand-mark">
      <rect width="48" height="48" rx="10" fill="#223a2a" />
      <rect x="12" y="10" width="24" height="30" rx="2" fill="#f6f3ea" />
      <rect x="16" y="16" width="16" height="2.4" rx="1.2" fill="#c9c1ab" />
      <rect x="16" y="21" width="16" height="2.4" rx="1.2" fill="#c9c1ab" />
      <path d="M16.5 30.5l4 4 8-9" fill="none" stroke="#35553f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="36" cy="12" r="5.5" fill="#b5772c" />
    </svg>
  );
}
