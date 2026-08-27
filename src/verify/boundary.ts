import { VAULT_MCP_SERVER_NAME } from "../agent/manifest.js";
import { snapshotArray, snapshotRecord } from "../contract/snapshot.js";
import { seedRows } from "../vault/seed.js";
import type { PersistedEvent } from "./events.js";

const VAULT_TOOLS = new Set([
  "describe_dataset",
  "prepare_analysis",
  "render_safe_chart",
  "validate_release",
  "release_result",
]);
const SENSITIVE_KEYS = new Set(["customer_id", "email", "phone", "free_text"]);
const SYNTHETIC_SENSITIVE_VALUES = Object.freeze(
  seedRows().flatMap((row) => [row.customer_id, row.email, row.phone, row.free_text]),
);

const RAW_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["customer id value", /CUST-\d/],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["synthetic phone value", /\+\d[\d\s\-()]{7,}\d/],
];

// Shared leak net for the gates: collect every string in a decoded structure
// and test it with the same values and patterns applied to MCP responses.
export function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(stringsIn);
}

export function containsRawValue(content: string): boolean {
  return (
    SYNTHETIC_SENSITIVE_VALUES.some((value) => content.includes(value)) ||
    RAW_PATTERNS.some(([, pattern]) => pattern.test(content))
  );
}

function scanContent(content: string): {
  readonly hasSensitiveKey: boolean;
  readonly strings: string[];
} {
  let sensitiveKey = /"(customer_id|email|phone|free_text)"\s*:/.test(content);
  const strings = [content];
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { hasSensitiveKey: sensitiveKey, strings };
  }

  const pending: Array<{ value: unknown; decodeDepth: number }> = [{ value, decodeDepth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const { value: item, decodeDepth } = current;
    if (typeof item === "string") {
      strings.push(item);
      if (/"(customer_id|email|phone|free_text)"\s*:/.test(item)) sensitiveKey = true;
      const trimmed = item.trim();
      if (
        decodeDepth < 64 &&
        ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]")))
      ) {
        try {
          pending.push({ value: JSON.parse(trimmed), decodeDepth: decodeDepth + 1 });
        } catch {
          // The raw key pattern above still catches malformed JSON strings.
        }
      }
      continue;
    }
    if (Array.isArray(item)) {
      pending.push(...item.map((child) => ({ value: child, decodeDepth })));
      continue;
    }
    const record = snapshotRecord(item);
    if (record === null) continue;
    for (const [key, child] of Object.entries(record)) {
      if (SENSITIVE_KEYS.has(key)) sensitiveKey = true;
      pending.push({ value: child, decodeDepth });
    }
  }
  return { hasSensitiveKey: sensitiveKey, strings };
}

export function checkVaultResponses(events: readonly PersistedEvent[]): {
  readonly responseCount: number;
  readonly failures: string[];
} {
  const vaultCallIds = new Set<string>();
  const mcpCallIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "model.message") continue;
    const calls = snapshotArray(event.tool_calls);
    if (calls === null) continue;
    for (const value of calls) {
      const call = snapshotRecord(value);
      const fn = call === null ? null : snapshotRecord(call.function);
      const info = call === null ? null : snapshotRecord(call.tool_info);
      if (typeof call?.id === "string" && info?.type === "mcp") {
        mcpCallIds.add(call.id);
      }
      if (
        typeof call?.id === "string" &&
        call.type === "function" &&
        typeof fn?.name === "string" &&
        VAULT_TOOLS.has(fn.name) &&
        info?.type === "mcp" &&
        info.name === fn.name &&
        info.server_id === VAULT_MCP_SERVER_NAME &&
        info.server_name === VAULT_MCP_SERVER_NAME
      ) {
        vaultCallIds.add(call.id);
      }
    }
  }

  const mcpResponses = events
    .filter(
      (event) =>
        event.type === "tool.response" &&
        typeof event.tool_call_id === "string" &&
        mcpCallIds.has(event.tool_call_id),
    )
    .map((event) =>
      typeof event.content === "string" ? event.content : JSON.stringify(event.content),
    );
  const responseCount = events.filter(
    (event) =>
      event.type === "tool.response" &&
      typeof event.tool_call_id === "string" &&
      vaultCallIds.has(event.tool_call_id),
  ).length;
  const scans = mcpResponses.map(scanContent);
  const decodedStrings = scans.flatMap((scan) => scan.strings);

  const failures: string[] = [];
  if (scans.some((scan) => scan.hasSensitiveKey)) {
    failures.push("sensitive column key found in a persisted MCP response");
  }
  if (
    decodedStrings.some((content) =>
      SYNTHETIC_SENSITIVE_VALUES.some((value) => content.includes(value)),
    )
  ) {
    failures.push("synthetic sensitive value found in a persisted MCP response");
  }
  for (const [label, pattern] of RAW_PATTERNS) {
    if (decodedStrings.some((content) => pattern.test(content))) {
      failures.push(`${label} found in a persisted MCP response`);
    }
  }
  return { responseCount, failures };
}
