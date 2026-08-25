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
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    out[key] = descriptor.value;
  }
  return out;
}

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
    if (!Number.isInteger(index) || index < 0 || index >= length) return null;
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
