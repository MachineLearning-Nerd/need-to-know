import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

it("keeps executable scripts in the strict TypeScript project", () => {
  const config = JSON.parse(readFileSync("tsconfig.json", "utf8")) as { include?: unknown };
  expect(config.include).toEqual(expect.arrayContaining(["src/**/*.ts", "scripts/**/*.ts"]));
});
