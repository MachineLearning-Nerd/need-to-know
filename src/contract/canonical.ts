import { createHash } from "node:crypto";

declare const hashBrand: unique symbol;
export type Sha256Hex = string & { readonly [hashBrand]: "sha256" };

// Local canonical form (sorted object keys, strict value domain) — deliberately
// NOT an RFC 8785 conformance claim. Fail closed: any value JSON.stringify would
// silently drop or mangle (undefined, NaN, functions, cycles) throws instead,
// because a silently-narrowed payload would hash as if it were complete.
export class CanonicalizeError extends Error {}

export function canonicalize(value: unknown): string {
  return write(value, new WeakSet());
}

function write(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizeError("non-finite number");
      // -0 serializes as "0" by design: JSON has no negative zero, so the
      // released canonical bytes are identical — equal values, equal hash.
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalizeError(`unsupported type: ${typeof value}`);
  }
  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalizeError("circular reference");
  seen.add(obj);
  try {
    if (Object.getOwnPropertySymbols(obj).length > 0) {
      throw new CanonicalizeError("symbol key");
    }
    if (Array.isArray(obj)) {
      // Array.prototype.map skips holes, so a sparse array would serialize
      // like a shorter one and collide with it — exactly the silent
      // narrowing this serializer exists to refuse. Descriptor reads reject
      // holes, accessors, and any own non-index property.
      for (const name of Object.getOwnPropertyNames(obj)) {
        if (name === "length") continue;
        const index = Number(name);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= obj.length ||
          String(index) !== name
        ) {
          throw new CanonicalizeError("non-index array property");
        }
      }
      const parts: string[] = [];
      for (let index = 0; index < obj.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, index);
        if (descriptor === undefined) throw new CanonicalizeError("sparse array hole");
        if (!("value" in descriptor) || !descriptor.enumerable) {
          throw new CanonicalizeError("non-data array element");
        }
        parts.push(write(descriptor.value, seen));
      }
      return `[${parts.join(",")}]`;
    }
    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
      throw new CanonicalizeError("non-plain object");
    }
    const entries = Object.getOwnPropertyNames(obj)
      .sort()
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(obj, key);
        // A hidden or computed key would be silently absent from the hash.
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new CanonicalizeError("non-data property");
        }
        return `${JSON.stringify(key)}:${write(descriptor.value, seen)}`;
      });
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

export function sha256Canonical(value: unknown): Sha256Hex {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex") as Sha256Hex;
}
