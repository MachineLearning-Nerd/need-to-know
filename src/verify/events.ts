// Paginated fetch of persisted TrueForge events, failing closed on anything
// short of a provably complete list. trueforge 0.1.4 caps event lists at 100
// per request, so a full page MUST be followed up — a verifier that treats
// the first page as the whole stream would PASS on evidence it never saw.

export type PersistedEvent = Record<string, unknown>;

export type FetchEventsResult =
  | { readonly ok: true; readonly events: PersistedEvent[] }
  | {
      readonly ok: false;
      readonly reason: "events_unavailable" | "events_partial";
      readonly detail: string;
    };

const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 10_000;

export function isSafeTrueForgeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function rowsOf(body: unknown): PersistedEvent[] | null {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return null;
  const rows: PersistedEvent[] = [];
  for (const row of data) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
    rows.push(row as PersistedEvent);
  }
  return rows;
}

function nextPageToken(body: unknown): string | null | undefined {
  const pagination = (body as { pagination?: unknown })?.pagination;
  if (typeof pagination !== "object" || pagination === null || Array.isArray(pagination)) {
    return undefined;
  }
  const token = (pagination as Record<string, unknown>).next_page_token;
  if (token === undefined || token === null) return null;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

export async function fetchTurnEvents(
  baseUrl: string,
  sessionId: string,
  turnId: string,
): Promise<FetchEventsResult> {
  if (!isSafeTrueForgeId(sessionId) || !isSafeTrueForgeId(turnId)) {
    return { ok: false, reason: "events_unavailable", detail: "session or turn id is malformed" };
  }
  const route = `${baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/events`;
  const events: PersistedEvent[] = [];
  const seenEventIds = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(route);
      url.searchParams.set("limit", String(PAGE_LIMIT));
      url.searchParams.set("order", "asc");
      if (pageToken !== undefined) url.searchParams.set("page_token", pageToken);
      const body = await getJson(url.toString());
      const rows = rowsOf(body);
      if (rows === null) {
        return { ok: false, reason: "events_unavailable", detail: "event list is not an array" };
      }
      for (const row of rows) {
        if (typeof row.id !== "string") {
          return { ok: false, reason: "events_unavailable", detail: "event row without an id" };
        }
        if (seenEventIds.has(row.id)) {
          return { ok: false, reason: "events_partial", detail: "event page rows overlap" };
        }
        seenEventIds.add(row.id);
      }
      events.push(...rows);
      const next = nextPageToken(body);
      if (next === null) return { ok: true, events };
      if (next === undefined) {
        return {
          ok: false,
          reason: "events_unavailable",
          detail: "event pagination metadata is malformed",
        };
      }
      if (seenTokens.has(next)) {
        return { ok: false, reason: "events_partial", detail: "event page token repeated" };
      }
      seenTokens.add(next);
      pageToken = next;
    }
    return { ok: false, reason: "events_partial", detail: `more than ${MAX_PAGES} pages` };
  } catch (error) {
    return { ok: false, reason: "events_unavailable", detail: (error as Error).message };
  }
}

const TURN_PAGE_LIMIT = 25;

// The session's ACTUAL turn list, paginated at the server's 25-turn cap with
// the same fail-closed rules as the event fetch. Callers compare this against
// a bundle's claimed turnIds — verifying only the claimed turns would let a
// crafted bundle omit the turn holding a denial or a canary leak.
export async function listSessionTurnIds(
  baseUrl: string,
  sessionId: string,
): Promise<
  | { readonly ok: true; readonly turnIds: string[] }
  | {
      readonly ok: false;
      readonly reason: "events_unavailable" | "events_partial";
      readonly detail: string;
    }
> {
  if (!isSafeTrueForgeId(sessionId)) {
    return { ok: false, reason: "events_unavailable", detail: "session id is malformed" };
  }
  const route = `${baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`;
  const turnIds: string[] = [];
  const seenTurnIds = new Set<string>();
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(route);
      url.searchParams.set("limit", String(TURN_PAGE_LIMIT));
      if (pageToken !== undefined) url.searchParams.set("page_token", pageToken);
      const body = await getJson(url.toString());
      const rows = rowsOf(body);
      if (rows === null) {
        return { ok: false, reason: "events_unavailable", detail: "turn list is not an array" };
      }
      for (const row of rows) {
        const state = snapshotTurnState(row.state);
        const previousTurnId = turnIds.at(-1) ?? null;
        if (
          !isSafeTrueForgeId(row.id) ||
          state !== "done" ||
          row.previous_turn_id !== previousTurnId
        ) {
          return {
            ok: false,
            reason: "events_partial",
            detail: "turn row is malformed, not terminal, or outside the linear session history",
          };
        }
        if (seenTurnIds.has(row.id)) {
          return { ok: false, reason: "events_partial", detail: "turn page rows overlap" };
        }
        seenTurnIds.add(row.id);
        turnIds.push(row.id);
      }
      const next = nextPageToken(body);
      if (next === null) return { ok: true, turnIds };
      if (next === undefined) {
        return {
          ok: false,
          reason: "events_unavailable",
          detail: "turn pagination metadata is malformed",
        };
      }
      if (seenTokens.has(next)) {
        return { ok: false, reason: "events_partial", detail: "turn page token repeated" };
      }
      seenTokens.add(next);
      pageToken = next;
    }
    return { ok: false, reason: "events_partial", detail: `more than ${MAX_PAGES} turn pages` };
  } catch (error) {
    return { ok: false, reason: "events_unavailable", detail: (error as Error).message };
  }
}

// Fetch events for every turn in order; any turn failing closed fails the lot.
export async function fetchSessionEvents(
  baseUrl: string,
  sessionId: string,
  turnIds: readonly string[],
): Promise<FetchEventsResult> {
  const events: PersistedEvent[] = [];
  const seenIds = new Set<string>();
  for (const turnId of turnIds) {
    const result = await fetchTurnEvents(baseUrl, sessionId, turnId);
    if (!result.ok) return result;
    if (
      !result.events.some((event) => event.type === "turn.created") ||
      !result.events.some((event) => event.type === "turn.done")
    ) {
      return {
        ok: false,
        reason: "events_partial",
        detail: `turn ${turnId.slice(0, 120)} lacks lifecycle boundaries`,
      };
    }
    for (const event of result.events) {
      const id = event.id as string;
      if (seenIds.has(id)) {
        return { ok: false, reason: "events_partial", detail: "event id repeated across turns" };
      }
      seenIds.add(id);
    }
    events.push(...result.events);
  }
  return { ok: true, events };
}

function snapshotTurnState(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return typeof (value as Record<string, unknown>).status === "string"
    ? ((value as Record<string, unknown>).status as string)
    : null;
}
