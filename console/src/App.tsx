import { TrueForgeUI } from "@truefoundry/trueforge-ui";

import { ClearanceLayout } from "./Layout.js";
import {
  ClearanceAgentSteps,
  ClearanceApprovalBar,
  ClearanceAskUserPrompt,
  ClearanceSubAgentCard,
} from "./overrides.js";
import { clearanceTheme } from "./theme.js";

// Same server as the bundled UI — the console is a different lens, not a
// different backend. Fallback (T8.5): open TrueForge's own UI on the base URL;
// both paths drive identical sessions.
const baseUrl = import.meta.env.VITE_TRUEFORGE_BASE_URL ?? "/";

export default function App() {
  return (
    <TrueForgeUI
      server={{ type: "trueforge", baseUrl }}
      layout={ClearanceLayout}
      theme={clearanceTheme}
      overrides={{
        ToolApprovalBar: ClearanceApprovalBar,
        AskUserPrompt: ClearanceAskUserPrompt,
        AgentStepsCard: ClearanceAgentSteps,
        SubAgentCard: ClearanceSubAgentCard,
      }}
    />
  );
}
