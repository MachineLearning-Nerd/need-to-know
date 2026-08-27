#!/usr/bin/env node
// Clean-run harness: one scripted full demo run per invocation, banked under
// runs/attempt-<n>/ with an honest tally in runs/index.json. A clean run is
// Gate A passing live (all four uncoached sessions) AND verify-receipt
// passing in live mode on the bundle that run just produced. Every attempt
// is recorded, clean or not — the denominator is part of the evidence.
//
// Usage: TRUEFORGE_BASE_URL=http://localhost:8891 clean-run

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  try {
    return JSON.parse(readFileSync(indexPath, "utf8")) as RunRecord[];
  } catch {
    return [];
  }
}

const index = readIndex();
const attempt = index.length + 1;
const attemptDir = join(runsDir, `attempt-${attempt}`);
mkdirSync(attemptDir, { recursive: true });

const bundlePath = join(attemptDir, "gate-a-bundle.json");
const startedAt = new Date().toISOString();
const startedMs = Date.now();

process.stdout.write(`clean-run: attempt ${attempt} — gate-a live\n`);
const gateA = spawnSync(
  process.execPath,
  ["--import", "./scripts/register-ts-loader.mjs", "scripts/gate-a.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
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
    { encoding: "utf8", env: process.env },
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
index.push(record);
writeFileSync(indexPath, JSON.stringify(index, null, 2));

const cleanCount = index.filter((entry) => entry.clean).length;
process.stdout.write(
  `clean-run: attempt ${attempt} ${record.clean ? "CLEAN" : "NOT CLEAN"} — tally ${cleanCount}/${index.length} clean\n`,
);
process.exit(record.clean ? 0 : 2);
