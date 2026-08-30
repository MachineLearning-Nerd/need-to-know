import { describe, expect, it, vi } from "vitest";

import { deleteConsoleSession, sessionCanBeDeleted } from "../console/src/sessionDeletion.js";

const EVIDENCE_SESSION_IDS = [
  "01m15v4m6wr4yecghca0v1vmsh",
  "01m15v9mf547w4181pvwqfek8h",
  "01m15ver81mj2xhwasz8ex2zs9",
  "01m15vkf4e5q5eymm7jdr2qda8",
  "01m15vqk3nrnfmf2bg3wxetg57",
];

describe("console session deletion", () => {
  it.each(EVIDENCE_SESSION_IDS)("rejects published evidence session %s", async (sessionId) => {
    const deleteSession = vi.fn(async () => undefined);

    expect(sessionCanBeDeleted(sessionId)).toBe(false);
    await expect(deleteConsoleSession(sessionId, deleteSession)).rejects.toThrow(
      "published evidence bundle",
    );
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("delegates an ordinary session exactly once", async () => {
    const deleteSession = vi.fn(async () => undefined);
    const sessionId = "01m19438w54mktakbhg4sta2ek";

    expect(sessionCanBeDeleted(sessionId)).toBe(true);
    await deleteConsoleSession(sessionId, deleteSession);
    expect(deleteSession).toHaveBeenCalledOnce();
    expect(deleteSession).toHaveBeenCalledWith(sessionId);
  });
});
