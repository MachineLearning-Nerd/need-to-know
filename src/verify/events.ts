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

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "content-type": "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

export async function fetchTurnEvents(
  baseUrl: string,
  sessionId: string,
  turnId: string,
): Promise<FetchEventsResult> {
  const route = `${baseUrl}/api/v1/sessions/${sessionId}/turns/${turnId}/events`;
  const events: PersistedEvent[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await getJson(`${route}?limit=${PAGE_LIMIT}&offset=${page * PAGE_LIMIT}`);
      const rows = rowsOf(body);
      if (rows === null) {
        return { ok: false, reason: "events_unavailable", detail: "event list is not an array" };
      }
      // If offset is silently ignored the server would replay page one; a
      // repeated leading id means we cannot prove completeness — fail closed.
      if (
        page > 0 &&
        rows.length > 0 &&
        rows[0]?.id !== undefined &&
        rows[0]?.id === events[0]?.id
      ) {
        return {
          ok: false,
          reason: "events_partial",
          detail: "pagination not honoured; refusing to verify a possibly truncated stream",
        };
      }
      events.push(...rows);
      if (rows.length < PAGE_LIMIT) return { ok: true, events };
    }
    return { ok: false, reason: "events_partial", detail: `more than ${MAX_PAGES} pages` };
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
  for (const turnId of turnIds) {
    const result = await fetchTurnEvents(baseUrl, sessionId, turnId);
    if (!result.ok) return result;
    events.push(...result.events);
  }
  return { ok: true, events };
}
