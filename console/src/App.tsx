import { ThreadListRow, type ThreadListRowProps, TrueForgeUI } from "@truefoundry/trueforge-ui";
import { useAuiState } from "@truefoundry/trueforge-ui/assistant-ui";
import {
  createTrueForgeAgentUIServer,
  createTrueForgeClient,
} from "@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter";

import { ClearanceLayout } from "./Layout.js";
import {
  ClearanceAgentSteps,
  ClearanceApprovalBar,
  ClearanceAskUserPrompt,
  ClearanceSubAgentCard,
} from "./overrides.js";
import { deleteConsoleSession, sessionCanBeDeleted } from "./sessionDeletion.js";
import { clearanceTheme } from "./theme.js";

// Same server as the bundled UI — the console is a different lens, not a
// different backend. Fallback (T8.5): open TrueForge's own UI on the base URL;
// both paths drive identical sessions.
const baseUrl = import.meta.env.VITE_TRUEFORGE_BASE_URL ?? "/";

const client = createTrueForgeClient({ baseUrl });
const server = {
  ...createTrueForgeAgentUIServer({ baseUrl }),
  deleteSession: ({ sessionId }: { sessionId: string }) =>
    deleteConsoleSession(sessionId, (id) => client.sessions.delete(id)),
};

function ClearanceThreadListRow(props: ThreadListRowProps) {
  const sessionId = useAuiState((state) => state.threadListItem.remoteId);
  const actions = sessionCanBeDeleted(sessionId) ? props.actions : undefined;
  return <ThreadListRow {...props} actions={actions} />;
}

export default function App() {
  return (
    <TrueForgeUI
      server={server}
      layout={ClearanceLayout}
      theme={clearanceTheme}
      overrides={{
        ToolApprovalBar: ClearanceApprovalBar,
        AskUserPrompt: ClearanceAskUserPrompt,
        AgentStepsCard: ClearanceAgentSteps,
        SubAgentCard: ClearanceSubAgentCard,
        ThreadListRow: ClearanceThreadListRow,
      }}
    />
  );
}
