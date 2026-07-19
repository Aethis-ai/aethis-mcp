/**
 * Tool-schema drift suite.
 *
 * Guards that the 30 MCP `server.tool()` input schemas never silently drift
 * from the deployed engine. The oracle is the live staging OpenAPI document —
 * nothing here vendors a copy of engine truth. The only hand-maintained
 * artefact is `tool-endpoint-map.ts`, which carries the tool -> operation
 * correspondence and field renames, not any schema.
 *
 * Two tiers:
 *  - Offline structural checks (always run, even with no network): every tool
 *    is mapped, no unknown tools, every input field is classified, no stale map
 *    keys. These catch a newly added/renamed field on the MCP side.
 *  - Live alignment checks (need the OpenAPI doc): every mapped operation
 *    exists, every path/query param exists, every mapped body field exists with
 *    a compatible type, and every required engine body field is covered. These
 *    catch an engine-side rename/removal/retype.
 *
 * Network policy: nightly sets `DRIFT_NETWORK_REQUIRED=1`, so an unreachable
 * OpenAPI document fails RED (never green-by-skip). The PR gate leaves it unset
 * and tolerates ONLY genuine unreachability (network error or a 5xx from the
 * host) with a loud warning; real drift still fails. A 4xx (a reachable host
 * serving a wrong/absent document) is always red.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

import { createToolHandlers, registerTools } from "../src/index.js";
import type { AethisClient } from "../src/client.js";
import { introspectShape, typesCompatible, type ZodShape } from "./helpers/zodIntrospect.js";
import {
  fetchOpenApi,
  OpenApiUnreachableError,
  type OpenApiDoc,
} from "./helpers/openapi.js";
import { TOOL_ENDPOINT_MAP, type ToolMapEntry } from "./tool-endpoint-map.js";

const NETWORK_REQUIRED = process.env.DRIFT_NETWORK_REQUIRED === "1";

/** Capture every registered tool's name and introspected input shape. */
function captureRegisteredTools(): Record<string, Record<string, ReturnType<typeof introspectShape>[string]>> {
  const handlers = createToolHandlers({} as unknown as AethisClient);
  const shapes: Record<string, ZodShape> = {};
  const fakeServer = {
    tool: (name: string, _description: string, third: unknown, _fourth?: unknown) => {
      // server.tool(name, description, schemaShape, handler) — 4 args; or
      // server.tool(name, description, handler) — 3 args, no input schema.
      shapes[name] = typeof third === "function" ? {} : (third as ZodShape);
    },
    prompt: () => {},
  } as unknown as Parameters<typeof registerTools>[0];
  registerTools(fakeServer, handlers);

  const out: Record<string, Record<string, ReturnType<typeof introspectShape>[string]>> = {};
  for (const [name, shape] of Object.entries(shapes)) {
    out[name] = introspectShape(shape);
  }
  return out;
}

const REGISTERED = captureRegisteredTools();

/** Every zod field name a map entry references (body/path/query/mcpOnly). */
function classifiedFields(entry: ToolMapEntry): Set<string> {
  const fields = new Set<string>();
  for (const ep of entry.endpoints) {
    for (const k of Object.keys(ep.body ?? {})) fields.add(k);
    for (const k of Object.keys(ep.pathParams ?? {})) fields.add(k);
    for (const k of Object.keys(ep.query ?? {})) fields.add(k);
  }
  for (const k of entry.mcpOnly ?? []) fields.add(k);
  return fields;
}

describe("drift: structural map integrity (offline)", () => {
  it("registers exactly 31 tools", () => {
    expect(Object.keys(REGISTERED).length).toBe(31);
  });

  it("every registered tool has a map entry, and every map entry is a real tool", () => {
    const registeredNames = new Set(Object.keys(REGISTERED));
    const mappedNames = new Set(Object.keys(TOOL_ENDPOINT_MAP));

    const unmapped = [...registeredNames].filter((n) => !mappedNames.has(n));
    const unknown = [...mappedNames].filter((n) => !registeredNames.has(n));

    expect(unmapped, `tools missing from tool-endpoint-map.ts: ${unmapped.join(", ")}`).toEqual([]);
    expect(unknown, `map references non-existent tools: ${unknown.join(", ")}`).toEqual([]);
  });

  it("every input field of every tool is classified, and no map key is stale", () => {
    const problems: string[] = [];
    for (const [tool, fields] of Object.entries(REGISTERED)) {
      const entry = TOOL_ENDPOINT_MAP[tool];
      if (!entry) continue; // covered by the mapping-completeness test
      const declared = new Set(Object.keys(fields));
      const classified = classifiedFields(entry);

      for (const f of declared) {
        if (!classified.has(f)) {
          problems.push(`${tool}: input field '${f}' is not classified in the map`);
        }
      }
      for (const f of classified) {
        if (!declared.has(f)) {
          problems.push(`${tool}: map references field '${f}' that the tool no longer declares`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("drift: live alignment against staging OpenAPI", () => {
  let doc: OpenApiDoc | null = null;
  let unreachable = false;

  beforeAll(async () => {
    try {
      doc = await fetchOpenApi();
    } catch (err) {
      if (err instanceof OpenApiUnreachableError) {
        unreachable = true;
        if (NETWORK_REQUIRED) throw err; // nightly: red, never skip
        // PR gate: tolerate a genuine network gap, loudly.
        console.warn(
          `\n[drift] WARNING: staging OpenAPI unreachable — live alignment checks SKIPPED ` +
            `for this PR run (structural checks still ran). Reason: ${err.message}\n`,
        );
        return;
      }
      throw err; // reachable host, bad response → real signal
    }
  });

  it("reports the engine version it validated against", () => {
    if (unreachable) return;
    expect(doc).not.toBeNull();
    console.info(`[drift] validated against staging engine ${doc!.version}`);
  });

  it("every mapped operation exists in the deployed OpenAPI document", () => {
    if (unreachable) return;
    const missing: string[] = [];
    for (const [tool, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      for (const ep of entry.endpoints) {
        const key = `${ep.method} ${ep.path}`;
        if (!doc!.operations.has(key)) missing.push(`${tool} -> ${key}`);
      }
    }
    expect(missing, `operations absent from the engine:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every mapped path/query parameter exists on its operation", () => {
    if (unreachable) return;
    const problems: string[] = [];
    for (const [tool, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      for (const ep of entry.endpoints) {
        const op = doc!.operations.get(`${ep.method} ${ep.path}`);
        if (!op) continue; // reported by the existence test
        for (const [, paramName] of Object.entries(ep.pathParams ?? {})) {
          if (!op.pathParams.has(paramName)) {
            problems.push(`${tool} ${ep.method} ${ep.path}: no path param '${paramName}'`);
          }
        }
        for (const [, paramName] of Object.entries(ep.query ?? {})) {
          if (!op.queryParams.has(paramName)) {
            problems.push(`${tool} ${ep.method} ${ep.path}: no query param '${paramName}'`);
          }
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every mapped body field exists on the engine model with a compatible type", () => {
    if (unreachable) return;
    const problems: string[] = [];
    for (const [tool, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      const fields = REGISTERED[tool];
      for (const ep of entry.endpoints) {
        if (ep.form || !ep.body) continue; // multipart / no JSON model
        const op = doc!.operations.get(`${ep.method} ${ep.path}`);
        if (!op) continue;
        if (op.body === null) {
          problems.push(
            `${tool} ${ep.method} ${ep.path}: map declares body fields but the engine op has no JSON body`,
          );
          continue;
        }
        for (const [zodField, engineField] of Object.entries(ep.body)) {
          const engine = op.body[engineField];
          if (!engine) {
            problems.push(
              `${tool} ${ep.method} ${ep.path}: engine model has no field '${engineField}'` +
                (zodField === engineField ? "" : ` (mapped from zod '${zodField}')`),
            );
            continue;
          }
          const zodShape = fields[zodField];
          if (zodShape && !typesCompatible(zodShape.type, engine.type)) {
            problems.push(
              `${tool} ${ep.method} ${ep.path}: field '${engineField}' type ${engine.type} ` +
                `incompatible with tool field '${zodField}' type ${zodShape.type}`,
            );
          }
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("no mcpOnly field is actually a body property on a mapped operation", () => {
    // mcpOnly is a silent-exclusion channel: a field parked there is never
    // drift-checked. Guard it — if a field marked mcpOnly IS a request-body
    // property on any of the tool's operations, it was mis-classified and real
    // drift would hide behind it.
    if (unreachable) return;
    const problems: string[] = [];
    for (const [tool, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      for (const field of entry.mcpOnly ?? []) {
        for (const ep of entry.endpoints) {
          if (ep.form || !ep.body) continue;
          const op = doc!.operations.get(`${ep.method} ${ep.path}`);
          if (!op || op.body === null) continue;
          if (op.body[field]) {
            problems.push(
              `${tool} ${ep.method} ${ep.path}: field '${field}' is marked mcpOnly ` +
                `but is a real body property on the engine model — mis-classified, drift would hide here`,
            );
          }
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every required engine body field is covered by a mapped input (or handler default)", () => {
    if (unreachable) return;
    const problems: string[] = [];
    for (const [tool, entry] of Object.entries(TOOL_ENDPOINT_MAP)) {
      for (const ep of entry.endpoints) {
        if (ep.form || !ep.body) continue;
        const op = doc!.operations.get(`${ep.method} ${ep.path}`);
        if (!op || op.body === null) continue;
        const mappedEngineFields = new Set(Object.values(ep.body));
        const defaults = new Set(ep.bodyDefaults ?? []);
        for (const [engineField, shape] of Object.entries(op.body)) {
          if (!shape.required) continue;
          if (mappedEngineFields.has(engineField) || defaults.has(engineField)) continue;
          problems.push(
            `${tool} ${ep.method} ${ep.path}: engine requires body field '${engineField}' ` +
              `but no tool input maps to it (engine added a required field?)`,
          );
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
