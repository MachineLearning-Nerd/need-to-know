import { describe, expect, it } from "vitest";

import { nonDeltaEventsMatchPersistence } from "./reconnect-events.js";

describe("nonDeltaEventsMatchPersistence", () => {
  const created = {
    id: "evt-1",
    type: "turn.created",
    createdAt: "2026-08-27T00:00:00Z",
    payload: { parentId: "turn-0", status: "running" },
  };
  const done = { id: "evt-2", type: "turn.done", payload: { status: "done" } };
  const persisted = [
    {
      id: "evt-1",
      type: "turn.created",
      created_at: "2026-08-27T00:00:00Z",
      payload: { parent_id: "turn-0", status: "running" },
    },
    done,
  ];

  it("accepts the exact persisted events while ignoring deltas", () => {
    expect(
      nonDeltaEventsMatchPersistence(
        [{ data: created }, { data: { id: "evt-1", type: "model.message.delta" } }, { data: done }],
        persisted,
      ),
    ).toBe(true);
  });

  it("rejects altered content even when every id still matches", () => {
    expect(
      nonDeltaEventsMatchPersistence(
        [{ data: { ...created, type: "tampered.type" } }, { data: done }],
        persisted,
      ),
    ).toBe(false);
  });

  it("rejects an extra id-less event instead of filtering it away", () => {
    expect(
      nonDeltaEventsMatchPersistence(
        [{ data: created }, { data: { type: "unexpected" } }, { data: done }],
        persisted,
      ),
    ).toBe(false);
  });

  it("allows only the pinned model-message persistence enrichment", () => {
    const model = {
      id: "evt-model",
      type: "model.message",
      createdAt: "stream-time",
      content: "hello",
    };
    expect(
      nonDeltaEventsMatchPersistence(
        [{ data: model }],
        [
          {
            id: model.id,
            type: model.type,
            created_at: "persisted-time",
            content: model.content,
            finish_reason: "stop",
            tool_calls: [],
            usage: {},
          },
        ],
      ),
    ).toBe(true);
    expect(
      nonDeltaEventsMatchPersistence([{ data: model }], [{ ...model, unexpected: true }]),
    ).toBe(false);
    expect(
      nonDeltaEventsMatchPersistence(
        [{ data: model }],
        [{ id: model.id, type: model.type, created_at: "persisted-time", content: model.content }],
      ),
    ).toBe(false);
  });

  it("rejects persisted events in a different order", () => {
    expect(
      nonDeltaEventsMatchPersistence([{ data: created }, { data: done }], [...persisted].reverse()),
    ).toBe(false);
  });
});
