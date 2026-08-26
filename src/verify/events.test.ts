import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSessionEvents, fetchTurnEvents, listSessionTurnIds } from "./events.js";

type Page = { limit: number; pageToken: string | null; path: string };

let server: Server | undefined;

function serve(handler: (page: Page) => unknown): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const page: Page = {
        limit: Number(url.searchParams.get("limit") ?? 0),
        pageToken: url.searchParams.get("page_token"),
        path: url.pathname,
      };
      const body = handler(page);
      if (body === null) {
        response.writeHead(500).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
    server.listen(0, "localhost", () => {
      const address = server?.address();
      resolve(`http://localhost:${typeof address === "object" ? address?.port : 0}`);
    });
  });
}

afterEach(() => {
  server?.close();
  server?.closeAllConnections();
  server = undefined;
  vi.unstubAllGlobals();
});

const event = (index: number) => ({ id: `evt-${index}`, type: "model.message" });
const turn = (index: number, status = "done", previousTurnId: string | null = null) => ({
  id: `t-${index}`,
  previous_turn_id: previousTurnId,
  state: { status },
});

describe("fetchTurnEvents", () => {
  it("returns a short single page complete", async () => {
    const base = await serve(() => ({ data: [event(0), event(1)], pagination: { limit: 100 } }));
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result).toEqual({ ok: true, events: [event(0), event(1)] });
  });

  it("follows pagination across a full page boundary", async () => {
    const all = Array.from({ length: 150 }, (_, index) => event(index));
    const base = await serve(({ limit, pageToken }) => {
      const offset = pageToken === null ? 0 : Number(pageToken);
      const data = all.slice(offset, offset + limit);
      const next = offset + data.length < all.length ? String(offset + data.length) : undefined;
      return { data, pagination: { limit, next_page_token: next } };
    });
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toHaveLength(150);
  });

  it("fails closed as events_partial when a page token cycles", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => event(index));
    const base = await serve(() => ({
      data: firstPage,
      pagination: { limit: 100, next_page_token: "same" },
    }));
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_partial" });
  });

  it("fails closed as events_unavailable on a server error", async () => {
    const base = await serve(() => null);
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_unavailable" });
  });

  it("fails closed as events_unavailable when the list is not an array", async () => {
    const base = await serve(() => ({ data: "not-a-list" }));
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_unavailable" });
  });

  it("fails closed when pagination metadata is missing", async () => {
    const base = await serve(() => ({ data: [event(0)] }));
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_unavailable" });
  });

  it("fails closed as events_unavailable when nothing listens", async () => {
    const result = await fetchTurnEvents("http://localhost:1", "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_unavailable" });
  });

  it("applies an abort signal to stalled TrueForge reads", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("aborted"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchTurnEvents("http://localhost:8891", "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_unavailable" });
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("listSessionTurnIds", () => {
  it("forwards the returned token across a 30-turn session", async () => {
    const all = Array.from({ length: 30 }, (_, index) =>
      turn(index, "done", index === 0 ? null : `t-${index - 1}`),
    );
    const requestedTokens: Array<string | null> = [];
    const base = await serve(({ limit, pageToken }) => {
      requestedTokens.push(pageToken);
      const offset = pageToken === null ? 0 : Number(pageToken);
      const data = all.slice(offset, offset + limit);
      const next = offset + data.length < all.length ? String(offset + data.length) : undefined;
      return { data, pagination: { limit, next_page_token: next } };
    });
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toEqual({ ok: true, turnIds: all.map((turn) => turn.id) });
    expect(requestedTokens).toEqual([null, "25"]);
  });

  it("fails closed when a turn page token cycles", async () => {
    const base = await serve(({ pageToken }) => ({
      data: pageToken === null ? [turn(1)] : [turn(2)],
      pagination: { limit: 25, next_page_token: "same" },
    }));
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toMatchObject({ ok: false, reason: "events_partial" });
  });

  it("fails closed on malformed turn pagination metadata", async () => {
    const base = await serve(() => ({
      data: [turn(1)],
      pagination: { limit: 25, next_page_token: 42 },
    }));
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toMatchObject({ ok: false, reason: "events_unavailable" });
  });

  it("fails closed on a turn row without an id", async () => {
    const base = await serve(() => ({
      data: [{ notId: true, state: { status: "done" } }],
      pagination: { limit: 25 },
    }));
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toMatchObject({ ok: false, reason: "events_partial" });
  });

  it("fails closed while any persisted turn is still running", async () => {
    const base = await serve(() => ({ data: [turn(1, "running")], pagination: { limit: 25 } }));
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toMatchObject({ ok: false, reason: "events_partial" });
  });

  it("fails closed when persisted turns are independent roots", async () => {
    const base = await serve(() => ({
      data: [turn(1), turn(2)],
      pagination: { limit: 25 },
    }));
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toMatchObject({ ok: false, reason: "events_partial" });
  });
});

describe("fetchSessionEvents", () => {
  it("concatenates turns in order and fails the lot on one bad turn", async () => {
    const base = await serve(({ path }) => ({
      data: [
        { id: `start-${path}`, type: "turn.created" },
        event(path.includes("/t-1/") ? 1 : 2),
        { id: `done-${path}`, type: "turn.done" },
      ],
      pagination: { limit: 100 },
    }));
    const good = await fetchSessionEvents(base, "s-1", ["t-1", "t-2"]);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.events).toHaveLength(6);

    const failing = await fetchSessionEvents("http://localhost:1", "s-1", ["t-1"]);
    expect(failing.ok).toBe(false);
  });

  it("fails closed when a turn event stream lacks lifecycle boundaries", async () => {
    const base = await serve(() => ({ data: [event(1)], pagination: { limit: 100 } }));
    const result = await fetchSessionEvents(base, "s-1", ["t-1"]);
    expect(result).toMatchObject({ ok: false, reason: "events_partial" });
  });
});
