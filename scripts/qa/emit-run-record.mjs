#!/usr/bin/env node
/**
 * Emit a `qa_runs`-shaped run record for the mcp-staging lane.
 *
 * The nightly staging-integration workflow calls this in an `always()` step so a
 * record lands whether the lane passed or failed (never green-by-skip — spec
 * Decision 9). The record shape mirrors `tda-server/tda/models/qa_run.py`
 * (QARun): the reporting-wiring phase (workspace#478 / P6) ingests it via the
 * tda-server#797 upsert pattern. `source: "dev_platform"` is the new lane group
 * P6 adds to the taxonomy; `lane: "mcp-staging"` is this lane.
 *
 * Usage: node scripts/qa/emit-run-record.mjs --verdict <pass|fail|blocked> [--out <path>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const verdictRaw = (arg("verdict", "unknown") || "unknown").toLowerCase();
const VERDICTS = new Set(["pass", "fail", "blocked", "degraded", "unknown"]);
const verdict = VERDICTS.has(verdictRaw) ? verdictRaw : "unknown";
const outPath = arg("out", "qa-run-record.json");

const STAGING_API = process.env.AETHIS_BASE_URL ?? "https://staging.api.aethis.ai";

const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const pkgVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "unknown";

async function engineVersion() {
  try {
    const resp = await fetch(`${STAGING_API}/openapi.json`, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) return "unknown";
    const doc = await resp.json();
    return doc?.info?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repo = process.env.GITHUB_REPOSITORY ?? "Aethis-ai/aethis-mcp";
const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
const runRef = process.env.GITHUB_RUN_ID
  ? `${server}/${repo}/actions/runs/${runId}/attempts/${attempt}`
  : null;

const engine = await engineVersion();

const record = {
  schema_version: 1,
  // Globally-unique per workflow run (like the smoke lane keys on run id), so
  // P6's ingest upserts idempotently and a re-run updates in place.
  natural_key: `mcp-staging:${runId}:${attempt}`,
  source: "dev_platform",
  lane: "mcp-staging",
  verdict,
  profile: null,
  engine_version: engine,
  run_date: new Date().toISOString().slice(0, 10),
  run_ref: runRef,
  artifact_ref: null,
  bugs: [],
  notes: `aethis-mcp ${pkgVersion} drift + staging integration lane against ${STAGING_API}`,
  raw: {
    package_version: pkgVersion,
    engine_version: engine,
    staging_api: STAGING_API,
    run_id: runId,
    run_attempt: attempt,
    verdict,
  },
};

writeFileSync(outPath, JSON.stringify(record, null, 2));
console.log(`[qa] wrote ${outPath}: verdict=${verdict} engine=${engine} pkg=${pkgVersion}`);
