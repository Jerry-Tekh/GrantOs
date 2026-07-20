// src/components/StatusPill.jsx
const LABELS = {
  completed: "pill-completed",
  partial: "pill-partial",
  not_completed: "pill-not_completed",
};

export default function StatusPill({ status }) {
  const cls = LABELS[status] || "pill-pending";
  const label = status || "not submitted";
  return <span className={`status-pill ${cls}`}>{label}</span>;
}
