import { describe, expect, it } from "vitest";

import { CanonicalizeError, canonicalize, sha256Canonical } from "./canonical.js";

describe("canonicalize", () => {
  it("is independent of object key order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("keeps array order significant", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("serializes negative zero as zero by design", () => {
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize({ n: -0 })).toBe(canonicalize({ n: 0 }));
  });

  it("serializes the strict value domain", () => {
    expect(canonicalize({ s: "x", n: 1.5, b: true, z: null, a: [1] })).toBe(
      '{"a":[1],"b":true,"n":1.5,"s":"x","z":null}',
    );
  });

  it("fails closed on values JSON would drop or mangle", () => {
    expect(() => canonicalize({ v: undefined })).toThrow(CanonicalizeError);
    expect(() => canonicalize({ v: Number.NaN })).toThrow(CanonicalizeError);
    expect(() => canonicalize({ v: Number.POSITIVE_INFINITY })).toThrow(CanonicalizeError);
    expect(() => canonicalize({ v: () => 1 })).toThrow(CanonicalizeError);
    expect(() => canonicalize({ v: 1n })).toThrow(CanonicalizeError);
    expect(() => canonicalize(new Date())).toThrow(CanonicalizeError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalize(cycle)).toThrow(CanonicalizeError);
  });

  it("fails closed on shapes whose content would be silently absent", () => {
    // A one-hole array previously serialized as "[]" — the same bytes and
    // hash as an actually empty array.
    expect(() => canonicalize(new Array(1))).toThrow(CanonicalizeError);
    // biome-ignore lint/suspicious/noSparseArray: the hole is the test subject
    expect(() => canonicalize([1, , 2])).toThrow(CanonicalizeError);

    const extra: unknown[] = [1];
    Object.defineProperty(extra, "smuggled", { value: "x", enumerable: true });
    expect(() => canonicalize(extra)).toThrow(CanonicalizeError);

    const hidden: Record<string, unknown> = { a: 1 };
    Object.defineProperty(hidden, "b", { value: 2, enumerable: false });
    expect(() => canonicalize(hidden)).toThrow(CanonicalizeError);

    const symbolic: Record<string | symbol, unknown> = { a: 1 };
    symbolic[Symbol("hidden")] = 2;
    expect(() => canonicalize(symbolic)).toThrow(CanonicalizeError);

    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "a", { enumerable: true, get: () => 1 });
    expect(() => canonicalize(accessor)).toThrow(CanonicalizeError);
  });
});

describe("sha256Canonical", () => {
  it("produces a stable 64-char hex digest", () => {
    const hash = sha256Canonical({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Canonical({ a: 1 })).toBe(hash);
  });

  it("changes when any value changes", () => {
    expect(sha256Canonical({ a: 1 })).not.toBe(sha256Canonical({ a: 2 }));
    expect(sha256Canonical({ a: "1" })).not.toBe(sha256Canonical({ a: 1 }));
  });
});
