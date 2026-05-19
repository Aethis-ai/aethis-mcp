/**
 * Credential resolution for Aethis API keys.
 *
 * Fallback chain (matches the Python CLI's config.resolve_api_key):
 *   1. AETHIS_API_KEY environment variable
 *   2. macOS Keychain (service: aethis-cli, account: api_key)
 *   3. ~/.config/aethis/credentials YAML file (refuses if not 0600 or if it
 *      resolves outside the user's home / XDG_CONFIG_HOME)
 */

import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

const KEYCHAIN_SERVICE = "aethis-cli";
const KEYCHAIN_ACCOUNT = "api_key";
const KEYCHAIN_TIMEOUT_MS = 5_000;

const LLM_KEYCHAIN_SERVICE_DEFAULT = "aethis-anthropic-key";

/**
 * Raised when the credentials file fails a safety check (sandbox escape via
 * symlink, world/group-readable permissions). Surfaced to the caller so the
 * tool layer can display a precise refusal instead of silently falling
 * through to "no key found".
 */
export class UnsafeCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCredentialsError";
  }
}

function fromEnvVar(): string | undefined {
  const key = process.env.AETHIS_API_KEY;
  return key?.trim() || undefined;
}

async function fromKeychain(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "security",
        ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
        { timeout: KEYCHAIN_TIMEOUT_MS },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        },
      );
    });
    const key = stdout.trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

async function safeRealpath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    // The root itself may not exist (e.g. $HOME is unset in a sandboxed
    // CI runner). Fall back to the lexical resolution.
    return p;
  }
}

/**
 * Resolve a credentials file path and assert it sits under a trusted root.
 *
 * Trusted roots:
 *   - the user's home directory, and
 *   - $XDG_CONFIG_HOME if set to an absolute path the user controls.
 *
 * Any other resolved location (symlinks pointing into /tmp, into another
 * user's home, into world-writable directories, etc.) is rejected.
 */
async function safeCredentialsPath(): Promise<string | null> {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const configDir = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  const declaredPath = join(configDir, "aethis", "credentials");

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(declaredPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }

  // Canonicalise the allowed roots too. On macOS in particular /var,
  // /tmp and /private/var are aliases — realpath() collapses them and we
  // have to compare canonical forms on both sides.
  const home = await safeRealpath(resolvePath(homedir()));
  const xdgRoot =
    xdg && isAbsolute(xdg) ? await safeRealpath(resolvePath(xdg)) : null;
  const allowed = xdgRoot ? [home, xdgRoot] : [home];
  const inside = allowed.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(root + "/"),
  );
  if (!inside) {
    throw new UnsafeCredentialsError(
      `Refusing to read credentials at '${declaredPath}': resolves to '${resolvedPath}', ` +
        `which is outside your home directory and any absolute XDG_CONFIG_HOME. ` +
        `Remove or fix the symlink and try again.`,
    );
  }
  return resolvedPath;
}

async function fromCredentialsFile(): Promise<string | undefined> {
  const credsPath = await safeCredentialsPath();
  if (!credsPath) return undefined;

  const info = await stat(credsPath);
  // Require the equivalent of `chmod 600`. Any group/other bit set is a
  // refusal — matches `ssh` and `aws-cli` behaviour, prevents another
  // local user from reading the key.
  const mode = info.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    const octal = mode.toString(8).padStart(3, "0");
    throw new UnsafeCredentialsError(
      `Permissions 0${octal} for '${credsPath}' are too open. ` +
        `Run: chmod 600 ${credsPath}`,
    );
  }

  const content = await readFile(credsPath, "utf-8");
  const match = content.match(/^api_key:\s*(.+)$/m);
  return match?.[1]?.trim() || undefined;
}

/**
 * Look up a generic-password from the macOS keychain by reference.
 *
 * Reference forms:
 *   - "service:account" — explicit
 *   - "account" alone — service defaults to `aethis-anthropic-key`
 *
 * Returns undefined on non-macOS or on lookup failure. Used by
 * resolveLlmKey() to give callers a no-raw-secret alternative to
 * passing anthropic_key as a tool argument (#35).
 */
export async function fromLlmKeychainEntry(
  reference: string,
): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  const ref = reference.trim();
  if (!ref) return undefined;
  let service: string;
  let account: string;
  const colon = ref.indexOf(":");
  if (colon > 0 && colon < ref.length - 1) {
    service = ref.slice(0, colon);
    account = ref.slice(colon + 1);
  } else {
    service = LLM_KEYCHAIN_SERVICE_DEFAULT;
    account = ref;
  }
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { timeout: KEYCHAIN_TIMEOUT_MS },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        },
      );
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Inputs to resolveLlmKey: any of the four fields may be provided. */
export interface LlmKeyArgs {
  anthropic_key?: string;
  openai_key?: string;
  anthropic_key_env?: string;
  anthropic_key_keychain?: string;
}

export class MissingLlmKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingLlmKeyError";
  }
}

/**
 * Resolve a per-call LLM API key from the safer reference forms first
 * (env var / keychain), falling back to the raw `anthropic_key` /
 * `openai_key` arguments. Throws MissingLlmKeyError if all forms are
 * empty.
 *
 * Background (#35): when an MCP host renders a tool call, raw secret
 * strings appear in the session transcript JSONL on disk. The reference
 * forms let the user keep the raw value off the wire — the server reads
 * it locally at call time from env or keychain.
 */
export async function resolveLlmKey(args: LlmKeyArgs): Promise<string> {
  const envName = args.anthropic_key_env?.trim();
  if (envName) {
    const v = process.env[envName]?.trim();
    if (v) return v;
  }
  const keychainRef = args.anthropic_key_keychain?.trim();
  if (keychainRef) {
    const v = await fromLlmKeychainEntry(keychainRef);
    if (v) return v;
  }
  const raw = args.anthropic_key?.trim() || args.openai_key?.trim();
  if (raw) return raw;

  throw new MissingLlmKeyError(
    "An Anthropic API key is required for this tool. " +
      "Preferred forms (raw value never appears in the session transcript):\n" +
      "  - anthropic_key_env: 'ANTHROPIC_API_KEY'  (env var name set in your MCP client config)\n" +
      "  - anthropic_key_keychain: 'my-anthropic'  (macOS keychain account; service defaults to 'aethis-anthropic-key')\n" +
      "Direct anthropic_key is also accepted but deprecated: the raw key lands in the host's session JSONL.",
  );
}

/**
 * Resolve an Aethis API key from available credential sources.
 * Throws if no key is found anywhere, or if the credentials file is
 * structurally unsafe (wrong permissions, symlinked outside $HOME).
 */
export async function resolveApiKey(): Promise<string> {
  const fromEnv = fromEnvVar();
  if (fromEnv) return fromEnv;

  const fromKc = await fromKeychain();
  if (fromKc) return fromKc;

  // UnsafeCredentialsError from this call deliberately propagates: the
  // refusal must be visible, not silently swallowed.
  const fromFile = await fromCredentialsFile();
  if (fromFile) return fromFile;

  throw new Error(
    "No Aethis API key found. Checked:\n" +
      "  1. $AETHIS_API_KEY environment variable\n" +
      "  2. macOS Keychain (service: aethis-cli)\n" +
      "  3. ~/.config/aethis/credentials\n\n" +
      "Run 'aethis login' to store your API key, or set AETHIS_API_KEY.\n" +
      "Note: Authentication is only needed for rule authoring — decision tools work without it.",
  );
}
