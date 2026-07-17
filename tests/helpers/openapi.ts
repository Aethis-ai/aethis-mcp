/**
 * Fetch and read the deployed engine's OpenAPI document — the *oracle* for the
 * drift suite. Nothing here vendors a copy of the schema: every request model
 * is resolved live from the fetched document's `components/schemas`.
 */

import type { FieldType } from "./zodIntrospect.js";

export const STAGING_OPENAPI_URL =
  process.env.AETHIS_OPENAPI_URL ?? "https://staging.api.aethis.ai/openapi.json";

export interface OpenApiModelField {
  type: FieldType;
  required: boolean;
}

export interface OpenApiOperation {
  method: string;
  path: string;
  /** Names of `in: path` parameters on the operation. */
  pathParams: Set<string>;
  /** Names of `in: query` parameters on the operation. */
  queryParams: Set<string>;
  /**
   * The JSON request-body model, `fieldName -> { type, required }`.
   * `null` when the operation declares no JSON body (GET, multipart, or
   * empty-body POST).
   */
  body: Record<string, OpenApiModelField> | null;
}

export interface OpenApiDoc {
  version: string;
  raw: Record<string, unknown>;
  /** `${METHOD} ${path}` -> operation, for exact lookup by the tool map. */
  operations: Map<string, OpenApiOperation>;
}

export class OpenApiUnreachableError extends Error {}

export async function fetchOpenApi(url: string = STAGING_OPENAPI_URL): Promise<OpenApiDoc> {
  // A transient network error or a server-side 5xx (502/503/504 from a
  // deploying/overloaded staging) is treated as unreachability: the caller
  // tolerates it on the PR gate and fails red only on the network-required
  // nightly. A 4xx — a reachable host serving the wrong or absent document —
  // is a real signal and always red. One retry absorbs a single transient hit.
  const ATTEMPTS = 2;
  let lastTransient = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      lastTransient = `network error: ${(err as Error).message}`;
      continue; // retry, then fall through to unreachable
    }
    if (resp.status >= 500) {
      lastTransient = `HTTP ${resp.status}`;
      continue; // 5xx → transient, retry then unreachable
    }
    if (resp.status >= 400) {
      throw new Error(`OpenAPI fetch returned HTTP ${resp.status} from ${url}`);
    }
    if (!resp.ok) {
      throw new Error(`OpenAPI fetch returned HTTP ${resp.status} from ${url}`);
    }
    const doc = (await resp.json()) as Record<string, unknown>;
    return parseOpenApi(doc);
  }
  throw new OpenApiUnreachableError(
    `Could not reach OpenAPI document at ${url} after ${ATTEMPTS} attempts (${lastTransient})`,
  );
}

function jsonTypeToFieldType(schema: Record<string, unknown>): FieldType {
  // Resolve a nullable union (`anyOf: [{type: X}, {type: null}]`) to X.
  const anyOf = (schema.anyOf ?? schema.oneOf) as Array<Record<string, unknown>> | undefined;
  if (anyOf) {
    const nonNull = anyOf.find((s) => s.type !== "null" || s.$ref);
    if (nonNull) return jsonTypeToFieldType(nonNull);
  }
  if (schema.$ref) return "object";
  const t = schema.type as string | undefined;
  switch (t) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "any";
  }
}

function resolveRef(
  ref: string,
  components: Record<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  // "#/components/schemas/DecideRequest"
  const name = ref.split("/").pop();
  if (!name) return null;
  return (components[name] as Record<string, unknown>) ?? null;
}

function modelFromSchema(
  schema: Record<string, unknown>,
  components: Record<string, Record<string, unknown>>,
): Record<string, OpenApiModelField> | null {
  let resolved = schema;
  if (typeof schema.$ref === "string") {
    const r = resolveRef(schema.$ref, components);
    if (!r) return null;
    resolved = r;
  }
  const props = resolved.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return null;
  const required = new Set((resolved.required as string[] | undefined) ?? []);
  const out: Record<string, OpenApiModelField> = {};
  for (const [key, propSchema] of Object.entries(props)) {
    out[key] = { type: jsonTypeToFieldType(propSchema), required: required.has(key) };
  }
  return out;
}

export function parseOpenApi(doc: Record<string, unknown>): OpenApiDoc {
  const info = (doc.info ?? {}) as Record<string, unknown>;
  const version = (info.version as string) ?? "unknown";
  const components = ((doc.components as Record<string, unknown>)?.schemas ??
    {}) as Record<string, Record<string, unknown>>;
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;

  const operations = new Map<string, OpenApiOperation>();
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, opRaw] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = opRaw as Record<string, unknown>;
      const params = (op.parameters ?? []) as Array<Record<string, unknown>>;
      const pathParams = new Set<string>();
      const queryParams = new Set<string>();
      for (const p of params) {
        if (p.in === "path") pathParams.add(p.name as string);
        else if (p.in === "query") queryParams.add(p.name as string);
      }
      let body: Record<string, OpenApiModelField> | null = null;
      const rb = op.requestBody as Record<string, unknown> | undefined;
      const jsonSchema = (
        (rb?.content as Record<string, Record<string, unknown>> | undefined)?.[
          "application/json"
        ]
      )?.schema as Record<string, unknown> | undefined;
      if (jsonSchema) body = modelFromSchema(jsonSchema, components);

      operations.set(`${method.toUpperCase()} ${path}`, {
        method: method.toUpperCase(),
        path,
        pathParams,
        queryParams,
        body,
      });
    }
  }
  return { version, raw: doc, operations };
}
