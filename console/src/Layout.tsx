import { BrandLogo, Thread, ThreadListContainer, useBrandName } from "@truefoundry/trueforge-ui";
import { useRef, useState } from "react";

import { EvidenceRail } from "./EvidenceRail.js";

// T8.2 — three columns: sessions, the conversation, and the evidence rail.
// The SDK wires server, runtime, and slots behind this component.
export function ClearanceLayout({ className }: { className?: string }) {
  const brandName = useBrandName();
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const hideSessionsButton = useRef<HTMLButtonElement>(null);
  const showSessionsButton = useRef<HTMLButtonElement>(null);

  function hideSessions() {
    setSessionsOpen(false);
    requestAnimationFrame(() => showSessionsButton.current?.focus());
  }

  function showSessions() {
    setSessionsOpen(true);
    requestAnimationFrame(() => hideSessionsButton.current?.focus());
  }

  return (
    <div className={`ck-shell ${className ?? ""}`}>
      <aside className="ck-sessions" id="console-sessions" hidden={!sessionsOpen}>
        <div className="ck-brand">
          <BrandLogo className="ck-brand-logo" />
          <div className="ck-brand-copy">
            <div className="ck-brand-name">{brandName}</div>
            <div className="ck-brand-sub">vault-gated release officer</div>
          </div>
          <button
            ref={hideSessionsButton}
            type="button"
            className="ck-sessions-toggle"
            onClick={hideSessions}
            aria-controls="console-sessions"
            aria-expanded={sessionsOpen}
            aria-label="Hide sessions"
          >
            «
          </button>
        </div>
        <ThreadListContainer />
      </aside>
      {!sessionsOpen && (
        <button
          ref={showSessionsButton}
          type="button"
          className="ck-sessions-toggle ck-sessions-opener"
          onClick={showSessions}
          aria-controls="console-sessions"
          aria-expanded={sessionsOpen}
          aria-label="Show sessions"
        >
          »
        </button>
      )}
      <main className="ck-thread">
        <Thread />
      </main>
      <EvidenceRail />
    </div>
  );
}
