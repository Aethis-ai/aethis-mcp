/**
 * Capability containment + annotation parity (aethis-mcp#45).
 *
 * The TOOL_CAPABILITIES registry in src/index.ts is the single source of truth
 * for each tool's auth profile and whether it mutates server state. This suite
 * makes that registry load-bearing rather than decorative:
 *
 *  1. Containment: no `auth: "anonymous"` tool is `mutating`. Anonymous
 *     (no-API-key) callers therefore have a strictly read-only capability
 *     surface — no registered mutation capability is reachable without a key.
 *  2. Auth parity: the `auth` classification matches which handlers actually
 *     call `requireAuth` in the source (found by static scan), so the registry
 *     cannot drift from the code that enforces it.
 *  3. Annotation parity: every registered MCP tool carries the annotations
 *     derived from its capability profile (readOnlyHint / destructiveHint /
 *     openWorldHint), so a host renders correct destructive/read hints and can
 *     gate approval on the mutating tools.
 *  4. Registry completeness: every registered tool and every handler has a
 *     capability entry; the one handler that is deliberately NOT registered
 *     (aethis_source) is accounted for.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  createToolHandlers,
  registerTools,
  TOOL_CAPABILITIES,
  toolAnnotations,
} from "../src/index.js";
import type { AethisClient } from "../src/client.js";

const SRC = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
const CLIENT_SRC = readFileSync(fileURLToPath(new URL("../src/client.ts", import.meta.url)), "utf8");

/** Handlers deliberately not exposed as MCP tools (callable, but unregistered). */
const UNREGISTERED = new Set(["aethis_source"]);

/** Static scan: which handlers call requireAuth in their body. */
function handlersCallingRequireAuth(): Set<string> {
  const out = new Set<string>();
  // Slice each handler body from `async aethis_X(` to the next `async aethis_`.
  const re = /async (aethis_[a-z_]+)\s*\(/g;
  const starts: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC)) !== null) starts.push({ name: m[1], index: m.index });
  for (let i = 0; i < starts.length; i++) {
    const body = SRC.slice(starts[i].index, starts[i + 1]?.index ?? SRC.length);
    if (body.includes("requireAuth(")) out.add(starts[i].name);
  }
  return out;
}

/** Slice each handler's source body: name -> body text. */
function handlerBodies(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /async (aethis_[a-z_]+)\s*\(/g;
  const starts: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC)) !== null) starts.push({ name: m[1], index: m.index });
  for (let i = 0; i < starts.length; i++) {
    out.set(starts[i].name, SRC.slice(starts[i].index, starts[i + 1]?.index ?? SRC.length));
  }
  return out;
}

/**
 * The client's state-changing methods, derived from the client module itself
 * (async methods whose name starts with a mutation verb) so the list cannot
 * drift from the code. `setApiKey` is sync auth-plumbing, not a data mutation,
 * and is not captured.
 */
function clientMutationMethods(): string[] {
  const names = [...CLIENT_SRC.matchAll(/\basync\s+([a-zA-Z_]+)\s*\(/g)].map((mm) => mm[1]);
  const MUT = /^(create|update|delete|remove|archive|publish|add|set|upload|generate|cancel)/;
  return [...new Set(names)].filter((n) => MUT.test(n));
}

/** Capture name -> annotations for every registered tool. */
function capturedAnnotations(): Record<string, Record<string, unknown>> {
  const handlers = createToolHandlers({} as unknown as AethisClient);
  const annotations: Record<string, Record<string, unknown>> = {};
  const isAnnotations = (a: unknown): a is Record<string, unknown> =>
    !!a && typeof a === "object" && "readOnlyHint" in (a as object);
  const fakeServer = {
    tool: (name: string, _description: string, ...rest: unknown[]) => {
      const ann = rest.find(isAnnotations);
      if (ann) annotations[name] = ann;
    },
    prompt: () => {},
  } as unknown as Parameters<typeof registerTools>[0];
  registerTools(fakeServer, handlers);
  return annotations;
}

const REQUIRE_AUTH = handlersCallingRequireAuth();
const ANNOTATIONS = capturedAnnotations();
const ALL_HANDLER_NAMES = Object.keys(createToolHandlers({} as unknown as AethisClient));

describe("capability registry completeness", () => {
  it("every handler has a capability entry, and every entry is a real handler", () => {
    const capKeys = new Set(Object.keys(TOOL_CAPABILITIES));
    const handlerNames = new Set(ALL_HANDLER_NAMES);
    const missing = [...handlerNames].filter((n) => !capKeys.has(n));
    const extra = [...capKeys].filter((n) => !handlerNames.has(n));
    expect(missing, `handlers with no capability entry: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `capability entries with no handler: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("containment: anonymous tools are read-only", () => {
  it("no anonymous tool is mutating", () => {
    const offenders = Object.entries(TOOL_CAPABILITIES)
      .filter(([, c]) => c.auth === "anonymous" && c.mutating)
      .map(([n]) => n);
    expect(offenders, `anonymous tools with mutation capability: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no anonymous tool is destructive", () => {
    const offenders = Object.entries(TOOL_CAPABILITIES)
      .filter(([, c]) => c.auth === "anonymous" && c.destructive)
      .map(([n]) => n);
    expect(offenders).toEqual([]);
  });
});

describe("auth parity: registry vs requireAuth in source", () => {
  it("auth==='api_key' iff the handler calls requireAuth", () => {
    const problems: string[] = [];
    for (const [name, cap] of Object.entries(TOOL_CAPABILITIES)) {
      const guarded = REQUIRE_AUTH.has(name);
      if (cap.auth === "api_key" && !guarded) {
        problems.push(`${name}: registry says api_key but handler does not call requireAuth`);
      }
      // A purely-anonymous tool must not guard. A hybrid (anonymous + a
      // conditional key-guarded path, e.g. aethis_graph) legitimately does.
      if (cap.auth === "anonymous" && !cap.hybrid && guarded) {
        problems.push(`${name}: registry says anonymous but handler calls requireAuth`);
      }
      if (cap.hybrid && !guarded) {
        problems.push(`${name}: registry says hybrid but handler has no requireAuth path`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("annotation parity: registered tools carry derived annotations", () => {
  it("every registered tool has annotations", () => {
    const registerable = Object.keys(TOOL_CAPABILITIES).filter((n) => !UNREGISTERED.has(n));
    const annotated = new Set(Object.keys(ANNOTATIONS));
    const missing = registerable.filter((n) => !annotated.has(n));
    expect(missing, `registered tools missing annotations: ${missing.join(", ")}`).toEqual([]);
    // aethis_source must NOT be registered.
    expect(annotated.has("aethis_source")).toBe(false);
  });

  it("each tool's annotations equal toolAnnotations(name)", () => {
    for (const [name, ann] of Object.entries(ANNOTATIONS)) {
      expect(ann, `annotations mismatch for ${name}`).toEqual(toolAnnotations(name));
    }
  });

  it("readOnlyHint is the negation of mutating; destructiveHint only on destructive mutations", () => {
    for (const [name, cap] of Object.entries(TOOL_CAPABILITIES)) {
      if (UNREGISTERED.has(name)) continue;
      const ann = toolAnnotations(name);
      expect(ann.readOnlyHint, `${name} readOnlyHint`).toBe(!cap.mutating);
      expect(ann.destructiveHint, `${name} destructiveHint`).toBe(cap.mutating ? cap.destructive === true : false);
      expect(ann.openWorldHint, `${name} openWorldHint`).toBe(true);
    }
  });
});

describe("mutation parity: mutating flag vs actual client calls", () => {
  // Cross-checks the hand-declared `mutating` flag against handler behaviour, so
  // a future tool mislabelled `mutating:false` that actually writes is caught
  // rather than passing every annotation test. The mutation-method list is
  // derived from the client module itself (can't drift from the code).
  const BODIES = handlerBodies();
  const MUTATION_METHODS = clientMutationMethods();

  it("derives a non-empty client mutation-method set", () => {
    expect(MUTATION_METHODS.length).toBeGreaterThan(0);
    // sanity: known writers are present
    for (const m of ["publish", "createProject", "archiveRuleset", "generateAndTest"]) {
      expect(MUTATION_METHODS, `expected ${m} in derived mutation set`).toContain(m);
    }
  });

  it("no mutating:false handler calls a client mutation method", () => {
    const problems: string[] = [];
    for (const [name, cap] of Object.entries(TOOL_CAPABILITIES)) {
      if (cap.mutating) continue;
      const body = BODIES.get(name) ?? "";
      for (const method of MUTATION_METHODS) {
        if (new RegExp(`\\.${method}\\s*\\(`).test(body)) {
          problems.push(`${name} is mutating:false but calls client.${method}()`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
