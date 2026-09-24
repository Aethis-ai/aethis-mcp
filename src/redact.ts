/**
 * Mask model-provider credentials (Anthropic `sk-ant-…`, OpenAI `sk-proj-…` /
 * `sk-…`, and provider-masked echoes such as `sk-ant-a****wxyz`) in any text
 * that is about to reach the MCP client. Upstream error bodies can quote a
 * rejected key; nothing key-shaped is ever relayed. Fails closed: a value that
 * cannot be rendered is replaced, never passed through.
 */
const KEY_PATTERN = /(?<![A-Za-z0-9])sk-(?:ant-|proj-|svcacct-|admin-)?[A-Za-z0-9_\-*.]{6,}/g;

export const REDACTED = "[REDACTED_PROVIDER_KEY]";

export function redactSecrets(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : String(value);
    return text.replace(KEY_PATTERN, REDACTED);
  } catch {
    return "<unredactable: value could not be rendered>";
  }
}
