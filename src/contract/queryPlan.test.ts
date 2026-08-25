import { describe, expect, it } from "vitest";

import { DATASET_VERSION } from "../vault/schema.js";
import { POLICY_VERSION } from "./policy.js";
import { checkProvenance, checkQueryPlan, type Provenance, type QueryPlan } from "./queryPlan.js";

const goodPlan: QueryPlan = {
  sourceDataset: "support",
  dimensions: ["week", "region"],
  metric: "ticket_count",
  filters: [],
  joins: [],
};

const goodProvenance: Provenance = {
  sourceDataset: "support",
  datasetVersion: DATASET_VERSION,
  queryId: "query-1",
};

function codes(findings: ReadonlyArray<{ code: string }>): string[] {
  return findings.map((finding) => finding.code);
}

describe("checkQueryPlan", () => {
  it("accepts the allowed source, safe dimensions, and allowed metric", () => {
    expect(checkQueryPlan(goodPlan)).toEqual([]);
  });

  it("rejects unapproved sources, dimensions, and metrics", () => {
    expect(codes(checkQueryPlan({ ...goodPlan, sourceDataset: "billing" }))).toContain(
      "plan_source_not_allowed",
    );
    for (const dimension of ["email", "customer_id", "free_text"]) {
      expect(checkQueryPlan({ ...goodPlan, dimensions: ["week", dimension] })).toEqual([
        { code: "plan_dimension_not_allowed", detail: dimension },
      ]);
    }
    expect(codes(checkQueryPlan({ ...goodPlan, metric: "email" }))).toContain(
      "plan_metric_not_allowed",
    );
  });

  it("caps oversized dimension lists with one finding instead of one per entry", () => {
    const bogus = Array.from({ length: 10_000 }, (_, i) => `dim_${i}`);
    expect(checkQueryPlan({ ...goodPlan, dimensions: bogus })).toEqual([
      { code: "too_many_dimensions", detail: "10000" },
    ]);
  });

  it("rejects duplicate dimensions the set comparison would collapse", () => {
    expect(checkQueryPlan({ ...goodPlan, dimensions: ["week", "region", "region"] })).toEqual([
      { code: "duplicate_dimension" },
    ]);
  });

  it("rejects any filter or join", () => {
    expect(codes(checkQueryPlan({ ...goodPlan, filters: [{ column: "region" }] }))).toContain(
      "plan_filter_not_allowed",
    );
    expect(codes(checkQueryPlan({ ...goodPlan, joins: [{ table: "tickets" }] }))).toContain(
      "plan_join_not_allowed",
    );
  });
});

describe("checkProvenance", () => {
  it("accepts matching provenance and current versions", () => {
    expect(checkProvenance(goodProvenance, goodPlan, DATASET_VERSION, POLICY_VERSION)).toEqual([]);
  });

  it("rejects source, dataset-version, and policy-version mismatches", () => {
    expect(
      codes(
        checkProvenance(
          { ...goodProvenance, sourceDataset: "billing" },
          goodPlan,
          DATASET_VERSION,
          POLICY_VERSION,
        ),
      ),
    ).toContain("provenance_source_mismatch");
    expect(
      codes(
        checkProvenance(
          { ...goodProvenance, datasetVersion: "support-tickets-v0" },
          goodPlan,
          DATASET_VERSION,
          POLICY_VERSION,
        ),
      ),
    ).toContain("dataset_version_mismatch");
    expect(
      codes(checkProvenance(goodProvenance, goodPlan, "support-tickets-v0", POLICY_VERSION)),
    ).toContain("dataset_version_mismatch");
    expect(
      codes(checkProvenance(goodProvenance, goodPlan, DATASET_VERSION, "policy-v0")),
    ).toContain("policy_version_mismatch");
  });
});
