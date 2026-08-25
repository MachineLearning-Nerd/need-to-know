// Single-read snapshotting: validation and hashing must never operate on the
// caller's objects, whose getters, proxies, overridden array methods, holes,
// or hidden properties can change or hide values between reads. Each helper
// reads every property exactly once via its descriptor and returns a fresh
// plain structure — or null, which the engine maps to needs_review.

export function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  // Null prototype: assigning a key named "__proto__" to a {} literal would
  // trigger the Object.prototype setter and graft the attacker's object onto
  // the snapshot's prototype chain instead of copying the key. The key is
  // also rejected outright — no rule ever declares it, so it can only be an
  // attempt to reach that setter.
  const names = Object.getOwnPropertyNames(value);
  // No valid record comes close: the candidate has 9 keys and a row has the
  // declared columns plus group_size. The cap keeps every later per-key loop
  // bounded regardless of what a hostile caller piles onto one object.
  if (names.length > MAX_SNAPSHOT_RECORD_KEYS) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of names) {
    if (key === "__proto__") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    out[key] = descriptor.value;
  }
  return out;
}

const MAX_SNAPSHOT_RECORD_KEYS = 64;
const MAX_SNAPSHOT_ARRAY_LENGTH = 10_000;

export function snapshotArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const length = value.length;
  if (!Number.isInteger(length) || length < 0 || length > MAX_SNAPSHOT_ARRAY_LENGTH) return null;
  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === "length") continue;
    const index = Number(name);
    // Any own non-index property is an override (e.g. a no-op forEach) — reject.
    // String(index) === name rejects index aliases ("00", " 1", "1e0", "")
    // that pass the numeric test but are not the property the indexed read
    // below would visit, so their values would silently vanish.
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== name) {
      return null;
    }
  }
  const out: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    // A missing descriptor is a hole; an accessor could return anything later.
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    out.push(descriptor.value);
  }
  return out;
}
