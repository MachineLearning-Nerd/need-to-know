import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const scratchDirectories: string[] = [];

function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "clean-run-test-"));
  scratchDirectories.push(directory);
  return directory;
}

function runCleanRun(directory: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(repoRoot, "scripts/register-ts-loader.mjs")).href,
      join(repoRoot, "scripts/clean-run.ts"),
    ],
    { cwd: directory, encoding: "utf8" },
  );
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("clean-run ledger", () => {
  it("rejects a parseable but structurally corrupt index without rewriting it", () => {
    const directory = scratchDirectory();
    mkdirSync(join(directory, "runs"));
    const corrupt = JSON.stringify([
      {
        attempt: 99,
        startedAt: false,
        durationSeconds: -1,
        gateAPass: "yes",
        verifyPass: true,
        clean: "yes",
      },
    ]);
    const indexPath = join(directory, "runs", "index.json");
    writeFileSync(indexPath, corrupt);

    const result = runCleanRun(directory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("runs/index.json is invalid");
    expect(readFileSync(indexPath, "utf8")).toBe(corrupt);
  });

  it("refuses to reuse an orphan attempt directory but still banks the attempt", () => {
    const directory = scratchDirectory();
    const runs = join(directory, "runs");
    mkdirSync(join(runs, "attempt-1"), { recursive: true });
    const indexPath = join(runs, "index.json");
    writeFileSync(indexPath, "[]");

    const result = runCleanRun(directory);

    // The pending record lands before the directory is created, so the
    // collision fails loud AND stays in the denominator — and the next
    // invocation numbers past the orphan directory instead of wedging.
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("EEXIST");
    expect(JSON.parse(readFileSync(indexPath, "utf8"))).toEqual([
      expect.objectContaining({ attempt: 1, gateAPass: false, verifyPass: false, clean: false }),
    ]);
  });

  it("banks a failed child run in the denominator", () => {
    const directory = scratchDirectory();

    const result = runCleanRun(directory);

    expect(result.status).toBe(2);
    expect(JSON.parse(readFileSync(join(directory, "runs", "index.json"), "utf8"))).toEqual([
      expect.objectContaining({
        attempt: 1,
        gateAPass: false,
        verifyPass: false,
        clean: false,
      }),
    ]);
  });
});
