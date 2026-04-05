#!/usr/bin/env node

/**
 * MCP server exposing Aethis developer API tools.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AethisClient, AethisAPIError } from "./client.js";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface TestCaseResult {
  name?: string;
  tc_id?: string;
  expected?: string;
  actual?: string | null;
  passed?: boolean;
  error?: string;
  field_errors?: Record<string, string> | null;
}

interface TestRunResult {
  bundle_id?: string;
  total?: number;
  passed?: number;
  failed?: number;
  errors?: number;
  results?: TestCaseResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function fmt(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function validateId(value: string, label: string): string | null {
  if (!value || !value.trim()) return `Error: ${label} must not be empty.`;
  return null;
}

function apiError(e: unknown): ToolResult {
  if (e instanceof AethisAPIError) {
    return err(`Error: ${e.detail} (HTTP ${e.statusCode})`);
  }
  return err(`Error: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// Format test results with diff tracking
// ---------------------------------------------------------------------------

export function formatTestResults(
  current: TestRunResult,
  previous: TestRunResult | null,
  iteration: number,
): string {
  const bundleId = current.bundle_id ?? "unknown";
  const total = current.total ?? 0;
  const passed = current.passed ?? 0;
  const results = current.results ?? [];

  const lines: string[] = [`=== Iteration ${iteration}: ${passed}/${total} passing ===`, ""];

  // Compute improvements and regressions if we have a previous run
  if (previous?.results) {
    const prevMap = new Map<string, boolean>();
    for (const r of previous.results) {
      const key = r.name ?? r.tc_id ?? "";
      if (key) prevMap.set(key, r.passed ?? false);
    }

    const improvements: string[] = [];
    const regressions: string[] = [];

    for (const r of results) {
      const key = r.name ?? r.tc_id ?? "";
      if (!key) continue;
      const wasPassing = prevMap.get(key);
      if (wasPassing === false && r.passed) {
        improvements.push(`  + ${key} — was FAIL, now PASS`);
      } else if (wasPassing === true && !r.passed) {
        regressions.push(`  ! ${key} — was PASS, now FAIL`);
      }
    }

    if (improvements.length) {
      lines.push("IMPROVED:");
      lines.push(...improvements, "");
    }
    if (regressions.length) {
      lines.push("!! REGRESSIONS (fix broke something that was working):");
      lines.push(...regressions, "");
    }
  }

  // Show remaining failures
  const failures = results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push("STILL FAILING:");
    for (const f of failures) {
      const name = f.name ?? f.tc_id ?? "unknown";
      if (f.error) {
        lines.push(`  x ${name}: ${f.error}`);
      } else {
        lines.push(`  x ${name}: expected ${f.expected ?? "unknown"}, got ${f.actual ?? "error"}`);
      }
    }
    lines.push("");
  }

  // Next steps
  if (passed === total && total > 0) {
    lines.push("All tests passing! Call aethis_publish to publish.");
  } else if (failures.length) {
    lines.push(
      "To fix remaining failures:\n" +
        "  - If the diagnosis points to a source text issue, call aethis_generate_and_test again\n" +
        "    (failure context is included automatically).\n" +
        "  - If it requires domain knowledge not in the source, call aethis_add_guidance\n" +
        "    with the missing information, then aethis_generate_and_test.",
    );
  }

  lines.push(`\nBundle: ${bundleId}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool handler factory (testable without MCP transport)
// ---------------------------------------------------------------------------

export type ToolHandlers = ReturnType<typeof createToolHandlers>;

export function createToolHandlers(client: AethisClient) {
  const REQUIRED_TC_KEYS = new Set(["name", "field_values", "expected_outcome"]);
  const VALID_OUTCOMES = new Set(["eligible", "not_eligible", "undetermined"]);

  // Track test results per project for diff detection across iterations
  const previousTestResults = new Map<string, TestRunResult>();
  const iterationCounts = new Map<string, number>();

  return {
    // -- Decision tools --

    async aethis_schema(args: { bundle_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.bundle_id, "bundle_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.getSchema(args.bundle_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_decide(args: {
      bundle_id: string;
      field_values: Record<string, unknown>;
      include_trace?: boolean;
      include_explanation?: boolean;
    }): Promise<ToolResult> {
      const idErr = validateId(args.bundle_id, "bundle_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.decide(args.bundle_id, args.field_values, {
          includeTrace: args.include_trace,
          includeExplanation: args.include_explanation,
        });
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_next_question(args: { bundle_id: string; field_values: Record<string, unknown> }): Promise<ToolResult> {
      const idErr = validateId(args.bundle_id, "bundle_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.decide(args.bundle_id, args.field_values) as Record<string, unknown>;
        const decision = result.decision as string | undefined;

        if (decision === "eligible") return ok("Decision: eligible. No more questions needed.");
        if (decision === "not_eligible") return ok("Decision: not eligible. No more questions needed.");

        const nq = result.next_question as { field_id: string; question: string; weight: number } | undefined;
        const path = (result.optimal_path ?? []) as Array<{ field_id: string; question: string; weight: number }>;
        const lines: string[] = [
          `Decision: undetermined (${result.fields_provided ?? 0}/${result.fields_evaluated ?? 0} fields provided)`,
        ];

        if (nq) {
          lines.push("\nNext question to ask:");
          lines.push(`  Field: ${nq.field_id}`);
          lines.push(`  Question: ${nq.question}`);
          lines.push(`  Priority weight: ${nq.weight} (lower = more important)`);
        }
        if (path.length) {
          lines.push(`\nFull remaining path (${path.length} questions):`);
          path.forEach((q, i) => {
            lines.push(`  ${i + 1}. ${q.question} (${q.field_id}, weight=${q.weight})`);
          });
        }
        const missing = result.missing_fields as string[] | undefined;
        if (missing?.length) {
          lines.push(`\nAll missing fields: ${missing.join(", ")}`);
        }
        return ok(lines.join("\n"));
      } catch (e) { return apiError(e); }
    },

    async aethis_explain(args: { bundle_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.bundle_id, "bundle_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.explain(args.bundle_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    // -- Discovery tools --

    async aethis_list_projects(_args: Record<string, never>): Promise<ToolResult> {
      try {
        const result = await client.listProjects();
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_project_status(args: { project_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.getStatus(args.project_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_list_bundles(args: { project_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.listBundles(args.project_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    // -- Test case tools --

    async aethis_list_tests(args: { project_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.listTests(args.project_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_get_test(args: { project_id: string; tc_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id") ?? validateId(args.tc_id, "tc_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.getTest(args.project_id, args.tc_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_update_test(args: {
      project_id: string;
      tc_id: string;
      name?: string;
      field_values?: Record<string, unknown>;
      expected_outcome?: string;
    }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id") ?? validateId(args.tc_id, "tc_id");
      if (idErr) return err(idErr);
      const updates: Record<string, unknown> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.field_values !== undefined) updates.field_values = args.field_values;
      if (args.expected_outcome !== undefined) {
        if (!VALID_OUTCOMES.has(args.expected_outcome)) {
          return err(`Error: invalid expected_outcome '${args.expected_outcome}'. Must be: eligible, not_eligible, or undetermined.`);
        }
        updates.expected_outcome = args.expected_outcome;
      }
      if (Object.keys(updates).length === 0) {
        return err("Error: at least one field to update must be provided (name, field_values, or expected_outcome).");
      }
      try {
        const result = await client.updateTest(args.project_id, args.tc_id, updates);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_delete_test(args: { project_id: string; tc_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id") ?? validateId(args.tc_id, "tc_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.deleteTest(args.project_id, args.tc_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    // -- Management tools --

    async aethis_archive_project(args: { project_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.archiveProject(args.project_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    async aethis_archive_bundle(args: { bundle_id: string }): Promise<ToolResult> {
      const idErr = validateId(args.bundle_id, "bundle_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.archiveBundle(args.bundle_id);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    // -- Authoring tools --

    async aethis_generate(args: { project_id: string; openai_key?: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.generate(args.project_id, args.openai_key);
        return ok(fmt(result));
      } catch (e) { return apiError(e); }
    },

    // -- Intelligent authoring tools --

    async aethis_create_ruleset(args: {
      name: string;
      section_id: string;
      source_text: string;
      test_cases: Array<Record<string, unknown>>;
      domain?: string;
    }): Promise<ToolResult> {
      if (!args.test_cases.length) {
        return err("Error: At least 1 test case is required. Rules authoring is test-driven — define expected outcomes first.");
      }
      for (let i = 0; i < args.test_cases.length; i++) {
        const tc = args.test_cases[i];
        const keys = new Set(Object.keys(tc));
        const missing = [...REQUIRED_TC_KEYS].filter((k) => !keys.has(k));
        if (missing.length) {
          return err(`Error: Test case ${i + 1} is missing keys: ${missing.sort().join(", ")}. Required: name, field_values, expected_outcome.`);
        }
        if (!VALID_OUTCOMES.has(tc.expected_outcome as string)) {
          return err(`Error: Test case ${i + 1} has invalid expected_outcome '${tc.expected_outcome}'. Must be: eligible, not_eligible, or undetermined.`);
        }
      }

      try {
        const project = await client.createProject(args.name, args.section_id, args.domain ?? "") as Record<string, unknown>;
        const projectId = project.project_id as string;
        const filename = `${args.section_id}.md`;
        await client.uploadSourceText(projectId, filename, args.source_text);
        await client.addTests(projectId, args.test_cases);

        return ok([
          "Ruleset project created successfully.",
          `  Project ID: ${projectId}`,
          `  Section: ${args.section_id}`,
          `  Source: ${args.source_text.length} characters uploaded as ${filename}`,
          `  Tests: ${args.test_cases.length} test case(s) added`,
          "",
          `Next step: Call aethis_generate_and_test(project_id="${projectId}") to generate rules and run tests.`,
        ].join("\n"));
      } catch (e) { return apiError(e); }
    },

    async aethis_add_guidance(args: { project_id: string; guidance_text: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        await client.addGuidance(args.project_id, args.guidance_text);
        return ok(
          `Guidance added to project ${args.project_id}.\n` +
            `Call aethis_generate_and_test(project_id="${args.project_id}") to regenerate with this guidance applied.`,
        );
      } catch (e) { return apiError(e); }
    },

    async aethis_generate_and_test(args: { project_id: string; openai_key?: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const result = await client.generateAndTest(args.project_id, args.openai_key) as TestRunResult;
        const prev = previousTestResults.get(args.project_id) ?? null;
        const iteration = (iterationCounts.get(args.project_id) ?? 0) + 1;
        iterationCounts.set(args.project_id, iteration);
        previousTestResults.set(args.project_id, result);
        return ok(formatTestResults(result, prev, iteration));
      } catch (e) { return apiError(e); }
    },

    async aethis_refine(args: { project_id: string; feedback?: string; openai_key?: string }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const feedback = args.feedback?.trim() ?? "";
        if (feedback) {
          await client.addGuidance(args.project_id, args.feedback!);
        }
        const result = await client.generateAndTest(args.project_id, args.openai_key) as TestRunResult;
        const prev = previousTestResults.get(args.project_id) ?? null;
        const iteration = (iterationCounts.get(args.project_id) ?? 0) + 1;
        iterationCounts.set(args.project_id, iteration);
        previousTestResults.set(args.project_id, result);

        let prefix = "";
        if (feedback) {
          const truncated = feedback.length > 100 ? feedback.slice(0, 100) + "..." : feedback;
          prefix = `Guidance added: "${truncated}"\n\n`;
        }
        return ok(prefix + formatTestResults(result, prev, iteration));
      } catch (e) { return apiError(e); }
    },

    async aethis_publish(args: { project_id: string; force?: boolean }): Promise<ToolResult> {
      const idErr = validateId(args.project_id, "project_id");
      if (idErr) return err(idErr);
      try {
        const testResult = await client.runTests(args.project_id) as TestRunResult;
        const total = testResult.total ?? 0;
        const passed = testResult.passed ?? 0;
        const failed = testResult.failed ?? 0;
        const errors = testResult.errors ?? 0;

        if ((failed > 0 || errors > 0) && !args.force) {
          const lines = [
            `Cannot publish: ${passed}/${total} tests passing (${failed} failed, ${errors} errors).`,
            "",
            "Failing tests:",
          ];
          const results = testResult.results ?? [];
          for (const r of results) {
            if (!r.passed) {
              lines.push(`  x ${r.name}: expected ${r.expected}, got ${r.actual ?? "error"}`);
            }
          }
          lines.push("", "Fix failures with aethis_generate_and_test or aethis_refine,");
          lines.push("or call aethis_publish with force=true to override.");
          return err(lines.join("\n"));
        }

        const pubResult = await client.publish(args.project_id) as Record<string, unknown>;
        const bundleId = (pubResult.bundle_id ?? "unknown") as string;
        const version = (pubResult.version ?? "unknown") as string;
        const deprecated = (pubResult.deprecated_bundles ?? []) as string[];

        const lines = [
          "Published successfully!",
          `  Bundle: ${bundleId}`,
          `  Version: ${version}`,
          `  Tests: ${passed}/${total} passing`,
        ];
        if (deprecated.length) {
          lines.push(`  Deprecated: ${deprecated.join(", ")}`);
        }
        return ok(lines.join("\n"));
      } catch (e) { return apiError(e); }
    },
  };
}

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------

function registerTools(server: McpServer, handlers: ToolHandlers): void {
  server.tool(
    "aethis_schema",
    "Get the input fields required for an eligibility check. Returns field names, types, descriptions, and allowed values. Use this before calling aethis_decide.",
    { bundle_id: z.string().describe("The ID of the published rule bundle") },
    (args) => handlers.aethis_schema(args),
  );

  server.tool(
    "aethis_decide",
    "Evaluate eligibility against a published rule bundle. Returns eligible/not_eligible/undetermined with optional trace and explanation. When undetermined, includes next_question and optimal_path.",
    {
      bundle_id: z.string().describe("The ID of the published rule bundle"),
      field_values: z.record(z.string(), z.unknown()).describe("Input field values (see aethis_schema for required fields)"),
      include_trace: z.boolean().optional().describe("Include the full evaluation trace showing how each rule was evaluated"),
      include_explanation: z.boolean().optional().describe("Include human-readable rule explanations with source citations"),
    },
    (args) => handlers.aethis_decide(args),
  );

  server.tool(
    "aethis_next_question",
    "Get the optimal next question for a conversational eligibility check. Call with empty field_values for the first question, then add answers and call again until decision is reached.",
    {
      bundle_id: z.string().describe("The ID of the published rule bundle"),
      field_values: z.record(z.string(), z.unknown()).describe("Answers collected so far (empty dict for first question)"),
    },
    (args) => handlers.aethis_next_question(args),
  );

  server.tool(
    "aethis_explain",
    "Get human-readable descriptions of the rules in a bundle, including criteria groups, requirements, and exception paths.",
    { bundle_id: z.string().describe("The ID of the published rule bundle") },
    (args) => handlers.aethis_explain(args),
  );

  server.tool(
    "aethis_list_projects",
    "List all projects in the current tenant. Returns project IDs, names, domains, and latest bundle information.",
    () => handlers.aethis_list_projects({}),
  );

  server.tool(
    "aethis_project_status",
    "Check the status of a project and its latest generation job (queued/running/success/failed).",
    { project_id: z.string().describe("The project ID") },
    (args) => handlers.aethis_project_status(args),
  );

  server.tool(
    "aethis_list_bundles",
    "List all rule bundles for a project, including version history. Shows bundle ID, status (active/archived), version, field count, and rule count.",
    { project_id: z.string().describe("The project ID") },
    (args) => handlers.aethis_list_bundles(args),
  );

  server.tool(
    "aethis_list_tests",
    "List all golden test cases for a project. Shows test name, input field values, and expected outcome for each case.",
    { project_id: z.string().describe("The project ID") },
    (args) => handlers.aethis_list_tests(args),
  );

  server.tool(
    "aethis_get_test",
    "Get a single test case by ID.",
    {
      project_id: z.string().describe("The project ID"),
      tc_id: z.string().describe("The test case ID (e.g., tc_abc123)"),
    },
    (args) => handlers.aethis_get_test(args),
  );

  server.tool(
    "aethis_update_test",
    "Update a test case. Only provided fields are changed — omit fields to keep their current value.",
    {
      project_id: z.string().describe("The project ID"),
      tc_id: z.string().describe("The test case ID to update"),
      name: z.string().optional().describe("New test case name"),
      field_values: z.record(z.string(), z.unknown()).optional().describe("New input field values"),
      expected_outcome: z.string().optional().describe("New expected outcome (eligible, not_eligible, or undetermined)"),
    },
    (args) => handlers.aethis_update_test(args),
  );

  server.tool(
    "aethis_delete_test",
    "Delete a test case from a project. This is permanent.",
    {
      project_id: z.string().describe("The project ID"),
      tc_id: z.string().describe("The test case ID to delete"),
    },
    (args) => handlers.aethis_delete_test(args),
  );

  server.tool(
    "aethis_archive_project",
    "Archive a project. Archived projects are preserved but excluded from listing. This is permanent.",
    { project_id: z.string().describe("The project ID to archive") },
    (args) => handlers.aethis_archive_project(args),
  );

  server.tool(
    "aethis_archive_bundle",
    "Archive a rule bundle. Archived bundles are preserved but excluded from /decide resolution. This is permanent.",
    { bundle_id: z.string().describe("The bundle ID to archive") },
    (args) => handlers.aethis_archive_bundle(args),
  );

  server.tool(
    "aethis_generate",
    "Trigger rule generation for a project. Queues an async job. Poll with aethis_project_status to check progress.",
    {
      project_id: z.string().describe("The project ID to generate rules for"),
      openai_key: z.string().optional().describe("Your OpenAI API key for LLM generation costs (required, pass-through, never stored)"),
    },
    (args) => handlers.aethis_generate(args),
  );

  server.tool(
    "aethis_create_ruleset",
    "Create a new ruleset project with source text and test cases (TDD). Test cases are required. After creation, call aethis_generate_and_test.",
    {
      name: z.string().describe("Human-readable name for the ruleset"),
      section_id: z.string().describe("Unique section identifier (e.g., 'flight_readiness')"),
      source_text: z.string().describe("The source legislation, policy, or specification text"),
      test_cases: z.array(z.record(z.string(), z.unknown())).describe("Test cases: [{name, field_values, expected_outcome}]. At least 1 required."),
      domain: z.string().optional().describe("Domain hint (e.g., 'uk_immigration')"),
    },
    (args) => handlers.aethis_create_ruleset(args),
  );

  server.tool(
    "aethis_add_guidance",
    "Add subject-matter-expert guidance to a project. Use for domain knowledge not in the source text. Then call aethis_generate_and_test to regenerate.",
    {
      project_id: z.string().describe("The project ID"),
      guidance_text: z.string().describe("Domain knowledge or correction not present in the source text"),
    },
    (args) => handlers.aethis_add_guidance(args),
  );

  server.tool(
    "aethis_generate_and_test",
    "Generate rules from source text and run all test cases. Triggers generation, polls until complete, then runs tests. Returns pass/fail with regression detection. Takes 60-120 seconds.",
    {
      project_id: z.string().describe("The project ID"),
      openai_key: z.string().optional().describe("Your OpenAI API key for LLM generation costs (required, pass-through, never stored)"),
    },
    (args) => handlers.aethis_generate_and_test(args),
  );

  server.tool(
    "aethis_refine",
    "Refine rules with optional feedback, then regenerate and test. Shortcut for add_guidance + generate_and_test.",
    {
      project_id: z.string().describe("The project ID"),
      feedback: z.string().optional().describe("Optional correction or domain knowledge to add before regenerating"),
      openai_key: z.string().optional().describe("Your OpenAI API key for LLM generation costs (required, pass-through, never stored)"),
    },
    (args) => handlers.aethis_refine(args),
  );

  server.tool(
    "aethis_publish",
    "Publish the latest rule bundle. Runs tests first and refuses if they fail unless force=true. Auto-deprecates previous active bundle.",
    {
      project_id: z.string().describe("The project ID"),
      force: z.boolean().optional().describe("Publish even if tests are not all passing"),
    },
    (args) => handlers.aethis_publish(args),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.AETHIS_API_KEY ?? "";
  const baseUrl = process.env.AETHIS_BASE_URL ?? "https://api.aethis.ai";

  const client = new AethisClient(apiKey, baseUrl);
  const handlers = createToolHandlers(client);

  const server = new McpServer(
    { name: "aethis", version: PKG_VERSION },
    {
      instructions:
        "Aethis is an AI platform for regulated eligibility checks. " +
        "Use aethis_list_projects to discover available projects, and aethis_list_bundles to see published bundles. " +
        "Use aethis_schema to discover what input fields a rule bundle requires, " +
        "then aethis_decide to evaluate eligibility (with optional include_trace and include_explanation for provenance), " +
        "and aethis_explain for human-readable rule descriptions. " +
        "To author new rules: aethis_create_ruleset (with test cases first — TDD), " +
        "then aethis_generate_and_test to iterate, and aethis_publish when passing.",
    },
  );

  registerTools(server, handlers);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run when executed directly (not when imported by tests)
const isDirectRun =
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.endsWith("index.ts");

if (isDirectRun) {
  main().catch((e) => {
    console.error("Fatal:", e.message ?? e);
    process.exit(1);
  });
}
