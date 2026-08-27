type StreamedEvent = { readonly data: { readonly type: string } & Record<string, unknown> };

type Normalized = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

function normalizeSdkFields(value: unknown): Normalized {
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value) {
      const normalized = normalizeSdkFields(item);
      if (!normalized.ok) return normalized;
      items.push(normalized.value);
    }
    return { ok: true, value: items };
  }
  if (typeof value !== "object" || value === null) return { ok: true, value };

  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (keys.has(normalizedKey)) return { ok: false };
    const normalizedChild = normalizeSdkFields(child);
    if (!normalizedChild.ok) return normalizedChild;
    keys.add(normalizedKey);
    entries.push([normalizedKey, normalizedChild.value]);
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return { ok: true, value: Object.fromEntries(entries) };
}

function eventMatchesPersistence(streamed: Record<string, unknown>, persisted: unknown): boolean {
  const normalizedStream = normalizeSdkFields(streamed);
  const normalizedPersisted = normalizeSdkFields(persisted);
  if (!normalizedStream.ok || !normalizedPersisted.ok) return false;
  if (
    typeof normalizedStream.value !== "object" ||
    normalizedStream.value === null ||
    Array.isArray(normalizedStream.value) ||
    typeof normalizedPersisted.value !== "object" ||
    normalizedPersisted.value === null ||
    Array.isArray(normalizedPersisted.value)
  ) {
    return false;
  }

  const stream = normalizedStream.value as Record<string, unknown>;
  const saved = normalizedPersisted.value as Record<string, unknown>;
  const type = stream.type;
  const ignoredStreamKeys = type === "model.message" ? new Set(["created_at"]) : new Set<string>();
  for (const [key, value] of Object.entries(stream)) {
    if (ignoredStreamKeys.has(key)) {
      if (!(key in saved)) return false;
      continue;
    }
    if (!(key in saved) || JSON.stringify(value) !== JSON.stringify(saved[key])) return false;
  }

  const persistedOnly = Object.keys(saved)
    .filter((key) => !(key in stream))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const expectedPersistedOnly =
    type === "model.message" ? ["finish_reason", "tool_calls", "usage"] : [];
  return JSON.stringify(persistedOnly) === JSON.stringify(expectedPersistedOnly);
}

export function nonDeltaEventsMatchPersistence(
  stitched: readonly StreamedEvent[],
  persisted: readonly Record<string, unknown>[],
): boolean {
  const streamed = stitched
    .map((event) => event.data)
    .filter((event) => !event.type.endsWith(".delta"));
  if (streamed.length === 0 || streamed.length !== persisted.length) return false;
  return streamed.every((event, index) => eventMatchesPersistence(event, persisted[index]));
}
