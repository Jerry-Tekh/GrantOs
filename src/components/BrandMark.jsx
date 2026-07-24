// src/components/BrandMark.jsx

/**
 * The signature idea behind GrantOS: independent validators each check the
 * same evidence and must agree before funds move. Three small nodes
 * (validators) converging into a single checkmark (consensus) -- the same
 * mark used in the hero verification diagram, echoed here at brand-mark
 * scale for consistency between the tab icon, header, and hero.
 */
export default function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="brand-mark">
      <rect width="48" height="48" rx="12" fill="#14213d" />
      <circle cx="14" cy="15" r="3.2" fill="#8b95a1" />
      <circle cx="34" cy="15" r="3.2" fill="#8b95a1" />
      <circle cx="24" cy="10" r="3.2" fill="#8b95a1" />
      <path d="M14 15 L24 27 L34 15 M24 10 L24 27" stroke="#3d4a5c" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="30" r="11" fill="#0f7b6c" />
      <path d="M18.5 30.2l4 4 7-8.4" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
