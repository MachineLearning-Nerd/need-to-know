import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { fetchSessionEvents, fetchTurnEvents } from "./events.js";

type Page = { limit: number; offset: number };

let server: Server | undefined;

function serve(handler: (page: Page) => unknown): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const page: Page = {
        limit: Number(url.searchParams.get("limit") ?? 0),
        offset: Number(url.searchParams.get("offset") ?? 0),
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
});

const event = (index: number) => ({ id: `evt-${index}`, type: "model.message" });

describe("fetchTurnEvents", () => {
  it("returns a short single page complete", async () => {
    const base = await serve(() => ({ data: [event(0), event(1)] }));
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result).toEqual({ ok: true, events: [event(0), event(1)] });
  });

  it("follows pagination across a full page boundary", async () => {
    const all = Array.from({ length: 150 }, (_, index) => event(index));
    const base = await serve(({ limit, offset }) => ({ data: all.slice(offset, offset + limit) }));
    const result = await fetchTurnEvents(base, "s-1", "t-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toHaveLength(150);
  });

  it("fails closed as events_partial when the server ignores offset", async () => {
    // 100 rows returned regardless of offset: page two replays page one, so
    // completeness cannot be proven and the verifier must not guess.
    const firstPage = Array.from({ length: 100 }, (_, index) => event(index));
    const base = await serve(() => ({ data: firstPage }));
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

  it("fails closed as events_unavailable when nothing listens", async () => {
    const result = await fetchTurnEvents("http://localhost:1", "s-1", "t-1");
    expect(result).toMatchObject({ ok: false, reason: "events_unavailable" });
  });
});

describe("listSessionTurnIds", () => {
  it("lists turns and fails closed when pagination is ignored", async () => {
    const { listSessionTurnIds } = await import("./events.js");
    const short = await serve(({ offset }) => ({
      data: offset === 0 ? [{ id: "t-1" }, { id: "t-2" }] : [],
    }));
    const listed = await listSessionTurnIds(short, "s-1");
    expect(listed).toEqual({ ok: true, turnIds: ["t-1", "t-2"] });
  });

  it("fails closed on a turn row without an id", async () => {
    const { listSessionTurnIds } = await import("./events.js");
    const base = await serve(() => ({ data: [{ notId: true }] }));
    const listed = await listSessionTurnIds(base, "s-1");
    expect(listed).toMatchObject({ ok: false, reason: "events_unavailable" });
  });
});

describe("fetchSessionEvents", () => {
  it("concatenates turns in order and fails the lot on one bad turn", async () => {
    const base = await serve(({ offset }) => ({ data: offset === 0 ? [event(0)] : [] }));
    const good = await fetchSessionEvents(base, "s-1", ["t-1", "t-2"]);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.events).toHaveLength(2);

    const failing = await fetchSessionEvents("http://localhost:1", "s-1", ["t-1"]);
    expect(failing.ok).toBe(false);
  });
});
