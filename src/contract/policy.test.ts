import { describe, expect, it } from "vitest";

import { ALLOWED_AUDIENCE, ALLOWED_PURPOSE, authorizeMission } from "./policy.js";

describe("authorizeMission", () => {
  it("authorizes exactly the fixed pair", () => {
    expect(authorizeMission(ALLOWED_PURPOSE, ALLOWED_AUDIENCE)).toEqual({ authorized: true });
  });

  it("denies near-miss purposes rather than correcting them", () => {
    const nearMisses = [
      "Weekly support trend",
      " weekly support trend",
      "weekly support trend ",
      "weekly support trends",
      "weekly  support trend",
      "",
    ];
    for (const purpose of nearMisses) {
      const result = authorizeMission(purpose, ALLOWED_AUDIENCE);
      expect(result, purpose).toEqual({ authorized: false, reasons: ["purpose_not_authorized"] });
    }
  });

  it("denies unauthorized audiences", () => {
    expect(authorizeMission(ALLOWED_PURPOSE, "marketing team")).toEqual({
      authorized: false,
      reasons: ["audience_not_authorized"],
    });
  });

  it("reports both reasons when both values are wrong", () => {
    expect(authorizeMission("export everything", "the public")).toEqual({
      authorized: false,
      reasons: ["purpose_not_authorized", "audience_not_authorized"],
    });
  });

  it("fails closed on non-string input", () => {
    for (const bad of [undefined, null, 42, ["weekly support trend"]]) {
      expect(authorizeMission(bad, ALLOWED_AUDIENCE).authorized, String(bad)).toBe(false);
      expect(authorizeMission(ALLOWED_PURPOSE, bad).authorized, String(bad)).toBe(false);
    }
  });
});
