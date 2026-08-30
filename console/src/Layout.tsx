import { BrandLogo, Thread, ThreadListContainer, useBrandName } from "@truefoundry/trueforge-ui";
import { useState } from "react";

import { EvidenceRail } from "./EvidenceRail.js";

// T8.2 — three columns: sessions, the conversation, and the evidence rail.
// The SDK wires server, runtime, and slots behind this component.
export function ClearanceLayout({ className }: { className?: string }) {
  const brandName = useBrandName();
  const [sessionsOpen, setSessionsOpen] = useState(true);
  return (
    <div className={`ck-shell ${className ?? ""}`}>
      {sessionsOpen ? (
        <aside className="ck-sessions" id="console-sessions">
          <div className="ck-brand">
            <BrandLogo className="ck-brand-logo" />
            <div className="ck-brand-copy">
              <div className="ck-brand-name">{brandName}</div>
              <div className="ck-brand-sub">vault-gated release officer</div>
            </div>
            <button
              type="button"
              className="ck-sessions-toggle"
              onClick={() => setSessionsOpen(false)}
              aria-controls="console-sessions"
              aria-expanded="true"
              aria-label="Hide sessions"
            >
              «
            </button>
          </div>
          <ThreadListContainer />
        </aside>
      ) : (
        <button
          type="button"
          className="ck-sessions-toggle ck-sessions-opener"
          onClick={() => setSessionsOpen(true)}
          aria-controls="console-sessions"
          aria-expanded="false"
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
