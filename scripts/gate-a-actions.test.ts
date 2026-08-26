import { describe, expect, it } from "vitest";

import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE } from "../src/contract/policy.js";
import { seedRows } from "../src/vault/seed.js";
import {
  askUqPrecedesApproval,
  exercisedQuestionAndApproval,
  GATE_A_USER_MESSAGE,
  gateABoundaryFailures,
  pendingSessionInput,
} from "./gate-a-actions.js";

describe("askUqPrecedesApproval", () => {
  const question = { type: "tool.response_required" };
  const approval = { type: "tool.approval_required" };
  const noise = { type: "model.message" };

  it("passes when the audience question pauses before the approval gate", () => {
    expect(askUqPrecedesApproval([noise, question, noise, approval])).toBe(true);
  });

  it("fails when the approval gate arrives before any question", () => {
    expect(askUqPrecedesApproval([approval, question])).toBe(false);
  });

  it("fails when either pause never happened", () => {
    expect(askUqPrecedesApproval([question, noise])).toBe(false);
    expect(askUqPrecedesApproval([noise, approval])).toBe(false);
    expect(askUqPrecedesApproval([])).toBe(false);
  });
});

describe("pendingSessionInput", () => {
  it("asks for only the audience that the deterministic driver answers", () => {
    expect(GATE_A_USER_MESSAGE).toContain(ALLOWED_PURPOSE);
    expect(GATE_A_USER_MESSAGE).not.toContain(ALLOWED_AUDIENCE);
  });

  it("answers Ask User Questions before continuing the session", () => {
    expect(
      pendingSessionInput(
        [
          {
            type: "tool.response_required",
            threadId: "main",
            toolCalls: [{ id: "question-1" }],
          },
        ],
        new Set(),
        "allow",
      ),
    ).toEqual({
      input: [
        {
          type: "user.tool_response",
          threadId: "main",
          toolCallId: "question-1",
          content: "support leadership",
        },
      ],
      approvalCount: 0,
      questionCount: 1,
    });
  });

  it("does not answer the same pending call twice", () => {
    expect(
      pendingSessionInput(
        [
          {
            type: "tool.approval_required",
            threadId: "main",
            toolCalls: [{ id: "release-1" }],
          },
        ],
        new Set(["release-1"]),
        "deny",
      ).input,
    ).toEqual([]);
  });

  it("fails Gate A when an approval is requested outside the root thread", () => {
    expect(() =>
      pendingSessionInput(
        [
          {
            type: "tool.approval_required",
            threadId: "child-1",
            toolCalls: [{ id: "release-1" }],
          },
        ],
        new Set(),
        "allow",
      ),
    ).toThrow("outside the root thread");
  });

  it("does not count an approval-only flow as exercising Ask User Questions", () => {
    expect(exercisedQuestionAndApproval(1, 0)).toBe(false);
    expect(exercisedQuestionAndApproval(1, 1)).toBe(true);
  });

  it("fails when only the denied persisted stream carries raw data", () => {
    const rawFreeText = seedRows()[0]?.free_text;
    if (rawFreeText === undefined) throw new Error("fixture has no rows");
    const denied = [
      {
        type: "model.message",
        tool_calls: [
          {
            id: "rogue-call",
            type: "function",
            function: { name: "dump_rows", arguments: "{}" },
            tool_info: {
              type: "mcp",
              name: "dump_rows",
              server_id: "rogue",
              server_name: "rogue",
            },
          },
        ],
      },
      {
        type: "tool.response",
        tool_call_id: "rogue-call",
        content: JSON.stringify([rawFreeText]),
      },
    ];

    expect(gateABoundaryFailures([], denied)).toEqual([
      "deny: synthetic sensitive value found in a persisted MCP response",
    ]);
  });
});
