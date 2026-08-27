#!/usr/bin/env node
// Clean-run harness: one scripted full demo run per invocation, banked under
// runs/attempt-<n>/ with an honest tally in runs/index.json. A clean run is
// Gate A passing live (all four uncoached sessions) AND verify-receipt
// passing in live mode on the bundle that run just produced. Every attempt
// is recorded, clean or not — the denominator is part of the evidence.
//
// Usage: TRUEFORGE_BASE_URL=http://localhost:8891 npm run clean-run

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Resolved once and passed to BOTH children explicitly: gate-a defaults a
// missing TRUEFORGE_BASE_URL to localhost, but verify-receipt keys LIVE mode
// off the variable itself — left implicit, an unset environment silently
// downgrades the verification to offline while still reporting PASS.
const baseUrl = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8891";

const runsDir = "runs";
const indexPath = join(runsDir, "index.json");

type RunRecord = {
  attempt: number;
  startedAt: string;
  durationSeconds: number;
  gateAPass: boolean;
  verifyPass: boolean;
  clean: boolean;
};

function readIndex(): RunRecord[] {
  let raw: string;
  try {
    raw = readFileSync(indexPath, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("runs/index.json is invalid");
  }
  if (!Array.isArray(parsed)) throw new Error("runs/index.json is invalid");
  for (const [index, value] of parsed.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("runs/index.json is invalid");
    }
    const record = value as Record<string, unknown>;
    const valid =
      record.attempt === index + 1 &&
      typeof record.startedAt === "string" &&
      Number.isFinite(Date.parse(record.startedAt)) &&
      Number.isInteger(record.durationSeconds) &&
      (record.durationSeconds as number) >= 0 &&
      typeof record.gateAPass === "boolean" &&
      typeof record.verifyPass === "boolean" &&
      typeof record.clean === "boolean" &&
      (!record.verifyPass || record.gateAPass === true) &&
      record.clean === (record.gateAPass === true && record.verifyPass === true);
    if (!valid) throw new Error("runs/index.json is invalid");
  }
  return parsed as RunRecord[];
}

function writeIndex(index: readonly RunRecord[]): void {
  const temporaryPath = `${indexPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(index, null, 2), { flag: "wx" });
  try {
    renameSync(temporaryPath, indexPath);
  } catch (error) {
    unlinkSync(temporaryPath);
    throw error;
  }
}

const index = readIndex();
const attempt = index.length + 1;
const attemptDir = join(runsDir, `attempt-${attempt}`);
mkdirSync(runsDir, { recursive: true });

const bundlePath = join(attemptDir, "gate-a-bundle.json");
const startedAt = new Date().toISOString();
const startedMs = Date.now();
const pendingRecord: RunRecord = {
  attempt,
  startedAt,
  durationSeconds: 0,
  gateAPass: false,
  verifyPass: false,
  clean: false,
};
index.push(pendingRecord);
// Bank a not-clean record before creating the directory or starting either
// child. A hard interruption can never disappear from the denominator or be
// mistaken for a clean attempt — and because the record always lands first,
// the next invocation numbers past it instead of colliding on the directory.
writeIndex(index);
// An interrupted attempt keeps this directory. Reusing it would overwrite
// evidence while leaving the denominator unchanged, so collisions fail loud.
mkdirSync(attemptDir);

process.stdout.write(`clean-run: attempt ${attempt} — gate-a live\n`);
const gateA = spawnSync(
  process.execPath,
  ["--import", "./scripts/register-ts-loader.mjs", "scripts/gate-a.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TRUEFORGE_BASE_URL: baseUrl,
      RESULT_PATH: join(attemptDir, "gate-a-result.json"),
      BUNDLE_PATH: bundlePath,
    },
  },
);
const gateAPass = gateA.status === 0;

let verifyPass = false;
if (gateAPass) {
  process.stdout.write(`clean-run: attempt ${attempt} — verify-receipt live\n`);
  const verify = spawnSync(
    process.execPath,
    ["--import", "./scripts/register-ts-loader.mjs", "src/verify/cli.ts", bundlePath],
    { encoding: "utf8", env: { ...process.env, TRUEFORGE_BASE_URL: baseUrl } },
  );
  verifyPass = verify.status === 0;
  writeFileSync(join(attemptDir, "verify-output.txt"), `${verify.stdout}\n${verify.stderr}`);
  process.stdout.write(verify.stdout);
}

const record: RunRecord = {
  attempt,
  startedAt,
  durationSeconds: Math.round((Date.now() - startedMs) / 1000),
  gateAPass,
  verifyPass,
  clean: gateAPass && verifyPass,
};
index[index.length - 1] = record;
writeIndex(index);

const cleanCount = index.filter((entry) => entry.clean).length;
process.stdout.write(
  `clean-run: attempt ${attempt} ${record.clean ? "CLEAN" : "NOT CLEAN"} — tally ${cleanCount}/${index.length} clean\n`,
);
process.exit(record.clean ? 0 : 2);
