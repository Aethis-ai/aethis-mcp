/**
 * Introspect a tool's zod input shape into a plain, comparable field map.
 *
 * The drift suite must compare the MCP tools' declared inputs against the
 * deployed engine's OpenAPI request models WITHOUT hand-vendoring a second
 * copy of either schema. We therefore read the tools' real zod shapes (the
 * exact objects passed to `server.tool(...)`) and walk zod's own internal
 * `_def` to derive `{ type, required }` per field — no static expectation
 * table, no `zod-to-json-schema` dependency.
 */

import { z } from "zod";

/** Normalized field type vocabulary shared with the OpenAPI side. */
export type FieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "any";

export interface FieldShape {
  type: FieldType;
  /** false when the zod field is `.optional()` or carries a `.default(...)`. */
  required: boolean;
}

/** The raw shape object passed as the 3rd arg to `server.tool(...)`. */
export type ZodShape = Record<string, z.ZodTypeAny>;

function typeNameOf(def: unknown): string {
  return (def as { typeName?: string })?.typeName ?? "";
}

/**
 * Peel `ZodOptional` / `ZodDefault` / `ZodNullable` wrappers off a field,
 * returning the inner type and whether the field is still required.
 * `.optional()` and `.default(...)` both make a field optional; `.nullable()`
 * alone does not (a nullable field must still be present).
 */
function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; required: boolean } {
  let current = schema;
  let required = true;
  // Guard against pathological nesting; real schemas are shallow.
  for (let i = 0; i < 10; i++) {
    const name = typeNameOf(current._def);
    if (name === "ZodOptional" || name === "ZodDefault") {
      required = false;
      current = (current._def as { innerType: z.ZodTypeAny }).innerType;
      continue;
    }
    if (name === "ZodNullable") {
      current = (current._def as { innerType: z.ZodTypeAny }).innerType;
      continue;
    }
    break;
  }
  return { inner: current, required };
}

function baseType(schema: z.ZodTypeAny): FieldType {
  const name = typeNameOf(schema._def);
  switch (name) {
    case "ZodString":
      return "string";
    case "ZodNumber": {
      const checks = (schema._def as { checks?: Array<{ kind: string }> }).checks ?? [];
      return checks.some((c) => c.kind === "int") ? "integer" : "number";
    }
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return "array";
    case "ZodObject":
    case "ZodRecord":
      return "object";
    case "ZodEnum":
    case "ZodNativeEnum":
      return "string";
    case "ZodLiteral": {
      const v = (schema._def as { value: unknown }).value;
      return typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string";
    }
    case "ZodUnknown":
    case "ZodAny":
      return "any";
    default:
      // Unknown zod node — treat as `any` so it never manufactures a false
      // type-mismatch; accounting still covers presence.
      return "any";
  }
}

/** Introspect one zod field into its `{ type, required }` shape. */
export function fieldShape(schema: z.ZodTypeAny): FieldShape {
  const { inner, required } = unwrap(schema);
  return { type: baseType(inner), required };
}

/** Introspect a whole tool input shape → `{ fieldName: FieldShape }`. */
export function introspectShape(shape: ZodShape): Record<string, FieldShape> {
  const out: Record<string, FieldShape> = {};
  for (const [key, schema] of Object.entries(shape)) {
    out[key] = fieldShape(schema);
  }
  return out;
}

/**
 * Two normalized types are compatible when they name the same JSON kind.
 * `any` matches anything (zod `unknown` / `record` conveys no narrower type),
 * and the two numeric kinds are mutually compatible.
 */
export function typesCompatible(a: FieldType, b: FieldType): boolean {
  if (a === "any" || b === "any") return true;
  const numeric = (t: FieldType) => t === "number" || t === "integer";
  if (numeric(a) && numeric(b)) return true;
  return a === b;
}
