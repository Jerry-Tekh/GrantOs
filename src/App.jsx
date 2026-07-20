// src/App.jsx
import { useState } from "react";
import { GrantOSProvider } from "./context/GrantOSContext";
import Header from "./components/Header";
import FunderDashboard from "./components/FunderDashboard";
import GranteeSubmission from "./components/GranteeSubmission";
import GrantBrowser from "./components/GrantBrowser";
import ErrorBoundary from "./components/ErrorBoundary";

const TABS = [
  { id: "funder", label: "Funder Dashboard", Component: FunderDashboard },
  { id: "grantee", label: "Grantee Submission", Component: GranteeSubmission },
  { id: "browse", label: "Grant Browser", Component: GrantBrowser },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("funder");

  return (
    <ErrorBoundary label="GrantOS" testId="app-error-boundary">
      <GrantOSProvider>
        <Header />
        <nav>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <main>
          {/*
            All three panels stay mounted at all times; only visibility is
            toggled via CSS (see .panel / .panel.active in index.css). Swapping
            which *component* rendered here on tab change used to unmount the
            inactive panels entirely, silently wiping in-progress form state
            (a half-filled "Create Grant" form, a loaded Grant Browser result,
            etc.) every time the user switched tabs and came back.

            Each panel also gets its own error boundary: a render crash in one
            tab (e.g. an unexpected contract response shape) would otherwise
            take the ENTIRE app down to a blank page -- confirmed directly by
            triggering one -- not just the tab that broke.
          */}
          {TABS.map(({ id, Component, label }) => (
            <div key={id} className={`panel ${activeTab === id ? "active" : ""}`} aria-hidden={activeTab !== id}>
              <ErrorBoundary label={label} testId={`panel-error-boundary-${id}`}>
                <Component />
              </ErrorBoundary>
            </div>
          ))}
        </main>
      </GrantOSProvider>
    </ErrorBoundary>
  );
}
