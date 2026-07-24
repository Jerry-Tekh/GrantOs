// src/App.jsx
import { useEffect, useState } from "react";
import { GrantOSProvider } from "./context/GrantOSContext";
import Header from "./components/Header";
import FunderDashboard from "./components/FunderDashboard";
import GranteeSubmission from "./components/GranteeSubmission";
import GrantBrowser from "./components/GrantBrowser";
import ErrorBoundary from "./components/ErrorBoundary";
import LandingPage from "./components/LandingPage";

const TABS = [
  { id: "funder", label: "Funder Dashboard", Component: FunderDashboard },
  { id: "grantee", label: "Grantee Submission", Component: GranteeSubmission },
  { id: "browse", label: "Grant Browser", Component: GrantBrowser },
];

function readIsAppRoute() {
  return typeof window !== "undefined" && window.location.hash.startsWith("#app");
}

function AppShell() {
  const [activeTab, setActiveTab] = useState("funder");

  return (
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
          every time the user switched tabs and came back.

          Each panel also gets its own error boundary: a render crash in one
          tab would otherwise take the ENTIRE app down to a blank page --
          confirmed directly by triggering one -- not just the tab that broke.
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
  );
}

export default function App() {
  // Simple hash-based routing (no router dependency needed for two views):
  // "#app" shows the product, anything else shows the marketing landing
  // page. Listening for hashchange means the browser's back/forward
  // buttons and a shared/bookmarked "#app" link both work correctly.
  const [isAppRoute, setIsAppRoute] = useState(readIsAppRoute);

  useEffect(() => {
    function onHashChange() {
      setIsAppRoute(readIsAppRoute());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function launchApp() {
    window.location.hash = "app";
    setIsAppRoute(true);
  }

  return (
    <ErrorBoundary label="GrantOS" testId="app-error-boundary">
      {isAppRoute ? <AppShell /> : <LandingPage onLaunch={launchApp} />}
    </ErrorBoundary>
  );
}
