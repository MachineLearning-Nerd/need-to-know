import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  deleteConsoleSession,
  EVIDENCE_SESSION_IDS,
  sessionCanBeDeleted,
} from "../console/src/sessionDeletion.js";

const publishedSessionIds = [9, 10, 11, 12, 13].map((attempt) => {
  const bundle = JSON.parse(readFileSync(`evidence/attempt-${attempt}-bundle.json`, "utf8")) as {
    evidence: { sessionId: string };
  };
  return bundle.evidence.sessionId;
});

describe("console session deletion", () => {
  it("matches every published evidence bundle", () => {
    expect(EVIDENCE_SESSION_IDS).toEqual(publishedSessionIds);
  });

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
