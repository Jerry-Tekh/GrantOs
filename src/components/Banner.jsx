// src/components/Banner.jsx

const ICONS = {
  ok: "✓",
  error: "⚠",
  pending: "○",
};

/**
 * A small inline status banner used for async operation feedback
 * (submitting / success / error). Renders nothing when there's no text,
 * so it doesn't take up visual space until there's something to say.
 */
export default function Banner({ text, kind, testId }) {
  if (!text) return <div className="msg" data-testid={testId} />;
  return (
    <div className={`msg msg-${kind || "info"}`} data-testid={testId}>
      <span className={`msg-icon ${kind === "pending" ? "spin" : ""}`}>{ICONS[kind] || ""}</span>
      {text}
    </div>
  );
}
