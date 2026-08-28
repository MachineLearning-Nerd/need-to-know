import { BrandLogo, Thread, ThreadListContainer, useBrandName } from "@truefoundry/trueforge-ui";

import { EvidenceRail } from "./EvidenceRail.js";

// T8.2 — three columns: sessions, the conversation, and the evidence rail.
// The SDK wires server, runtime, and slots behind this component.
export function ClearanceLayout({ className }: { className?: string }) {
  const brandName = useBrandName();
  return (
    <div className={`ck-shell ${className ?? ""}`}>
      <aside className="ck-sessions">
        <div className="ck-brand">
          <BrandLogo className="ck-brand-logo" />
          <div>
            <div className="ck-brand-name">{brandName}</div>
            <div className="ck-brand-sub">vault-gated release officer</div>
          </div>
        </div>
        <ThreadListContainer />
      </aside>
      <main className="ck-thread">
        <Thread />
      </main>
      <EvidenceRail />
    </div>
  );
}
