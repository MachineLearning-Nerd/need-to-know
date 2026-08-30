// Live receipt verification refetches these published sessions.
export const EVIDENCE_SESSION_IDS = Object.freeze([
  "01m15v4m6wr4yecghca0v1vmsh",
  "01m15v9mf547w4181pvwqfek8h",
  "01m15ver81mj2xhwasz8ex2zs9",
  "01m15vkf4e5q5eymm7jdr2qda8",
  "01m15vqk3nrnfmf2bg3wxetg57",
]);

const evidenceSessionIds = new Set<string>(EVIDENCE_SESSION_IDS);

export function sessionCanBeDeleted(sessionId: string | undefined): boolean {
  return sessionId !== undefined && !evidenceSessionIds.has(sessionId);
}

export async function deleteConsoleSession(
  sessionId: string,
  deleteSession: (sessionId: string) => Promise<unknown>,
): Promise<void> {
  if (!sessionCanBeDeleted(sessionId)) {
    throw new Error(
      "This session is pinned by a published evidence bundle and cannot be deleted from this console.",
    );
  }
  await deleteSession(sessionId);
}
