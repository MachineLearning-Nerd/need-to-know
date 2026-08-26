import { describe, expect, it } from "vitest";

import { seedRows } from "../vault/seed.js";
import { checkVaultResponses } from "./boundary.js";

function vaultResponse(content: string) {
  return [
    {
      type: "model.message",
      tool_calls: [
        {
          id: "call-vault",
          type: "function",
          function: { name: "prepare_analysis", arguments: "{}" },
          tool_info: {
            type: "mcp",
            name: "prepare_analysis",
            server_id: "vault",
            server_name: "vault",
          },
        },
      ],
    },
    { type: "tool.response", tool_call_id: "call-vault", content },
  ];
}

describe("checkVaultResponses", () => {
  it("scans non-JSON Vault responses for raw values", () => {
    const result = checkVaultResponses(
      vaultResponse("CUST-999 customer999@example.com +1-555-0199"),
    );
    expect(result.failures).toEqual([
      "customer id value found in a persisted MCP response",
      "email address found in a persisted MCP response",
      "synthetic phone value found in a persisted MCP response",
    ]);
  });

  it("does not mistake hexadecimal hashes for phone values", () => {
    const result = checkVaultResponses(
      vaultResponse(`{"outputHash":"${"a".repeat(20)}1234567890"}`),
    );
    expect(result.failures).toEqual([]);
  });

  it("rejects sensitive keys regardless of JSON whitespace or nesting", () => {
    const result = checkVaultResponses(vaultResponse('{"nested":{"email" : null}}'));
    expect(result.failures).toEqual(["sensitive column key found in a persisted MCP response"]);
  });

  it("rejects free-text fields even when their value has no contact pattern", () => {
    const result = checkVaultResponses(vaultResponse('{"free_text":"ordinary words"}'));
    expect(result.failures).toEqual(["sensitive column key found in a persisted MCP response"]);
  });

  it("rejects sensitive keys nested inside JSON-string fields", () => {
    const result = checkVaultResponses(
      vaultResponse(JSON.stringify({ payload: JSON.stringify({ free_text: "ordinary words" }) })),
    );
    expect(result.failures).toEqual(["sensitive column key found in a persisted MCP response"]);
  });

  it("scans a rogue MCP response without counting it as Vault provenance", () => {
    const events = vaultResponse('{"email":"victim@example.com","customer_id":"CUST-9999"}');
    const source = events[0] as { tool_calls: Array<{ tool_info: Record<string, unknown> }> };
    const call = source.tool_calls[0];
    if (call === undefined) throw new Error("fixture has no tool call");
    call.tool_info.server_id = "evil";
    call.tool_info.server_name = "evil";
    expect(checkVaultResponses(events)).toEqual({
      responseCount: 0,
      failures: [
        "sensitive column key found in a persisted MCP response",
        "customer id value found in a persisted MCP response",
        "email address found in a persisted MCP response",
      ],
    });
  });

  it("rejects keyless raw free text from any persisted MCP response", () => {
    const freeText = seedRows()[0]?.free_text;
    if (freeText === undefined) throw new Error("fixture has no rows");
    const events = vaultResponse(JSON.stringify([freeText]));
    const source = events[0] as { tool_calls: Array<{ tool_info: Record<string, unknown> }> };
    const call = source.tool_calls[0];
    if (call === undefined) throw new Error("fixture has no tool call");
    call.tool_info.server_id = "rogue";
    call.tool_info.server_name = "rogue";

    expect(checkVaultResponses(events)).toEqual({
      responseCount: 0,
      failures: ["synthetic sensitive value found in a persisted MCP response"],
    });
  });

  it("rejects Unicode-escaped keyless raw free text after JSON decoding", () => {
    const freeText = seedRows()[0]?.free_text;
    if (freeText === undefined) throw new Error("fixture has no rows");
    const escaped = JSON.stringify([freeText]).replace("Ticket", "\\u0054icket");
    const events = vaultResponse(escaped);
    const source = events[0] as { tool_calls: Array<{ tool_info: Record<string, unknown> }> };
    const call = source.tool_calls[0];
    if (call === undefined) throw new Error("fixture has no tool call");
    call.tool_info.server_id = "rogue";
    call.tool_info.server_name = "rogue";

    expect(checkVaultResponses(events)).toEqual({
      responseCount: 0,
      failures: ["synthetic sensitive value found in a persisted MCP response"],
    });
  });

  it("does not let benign JSON siblings consume the nested decode limit", () => {
    const freeText = seedRows()[0]?.free_text;
    if (freeText === undefined) throw new Error("fixture has no rows");
    const escaped = JSON.stringify([freeText]).replace("Ticket", "\\u0054icket");
    const content = JSON.stringify([escaped, ...Array.from({ length: 64 }, () => "{}")]);
    const events = vaultResponse(content);
    const source = events[0] as { tool_calls: Array<{ tool_info: Record<string, unknown> }> };
    const call = source.tool_calls[0];
    if (call === undefined) throw new Error("fixture has no tool call");
    call.tool_info.server_id = "rogue";
    call.tool_info.server_name = "rogue";

    expect(checkVaultResponses(events)).toEqual({
      responseCount: 0,
      failures: ["synthetic sensitive value found in a persisted MCP response"],
    });
  });

  it("does not scan TrueForge system documentation as Vault output", () => {
    const result = checkVaultResponses([
      {
        type: "model.message",
        tool_calls: [
          {
            id: "call-openui",
            function: { name: "get_openui_instructions", arguments: "{}" },
            tool_info: { type: "truefoundry-system" },
          },
        ],
      },
      {
        type: "tool.response",
        tool_call_id: "call-openui",
        content: "Example: you@example.com",
      },
    ]);
    expect(result).toEqual({ responseCount: 0, failures: [] });
  });
});
