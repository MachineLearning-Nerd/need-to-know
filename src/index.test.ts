import { describe, expect, it } from "vitest";

import { projectName } from "./index.js";

describe("project scaffold", () => {
  it("loads the project entry point", () => {
    expect(projectName).toBe("Need-to-Know");
  });
});
