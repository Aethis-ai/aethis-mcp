/**
 * Resolve Aethis credentials and endpoint as one configuration snapshot.
 * Explicit process environment overrides take precedence; the selected CLI
 * profile outranks legacy keychain and flat-file credentials.
 */

import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { parseDocument } from "yaml";

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
async function safeCredentialsPath(suffix = ""): Promise<string | null> {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg && !isAbsolute(xdg)) {
    throw new UnsafeCredentialsError("XDG_CONFIG_HOME must be an absolute path. Fix the MCP process environment and restart.");
  }
  const configDir = xdg || join(homedir(), ".config");
  const declaredPath = join(configDir, "aethis", "credentials" + suffix);

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

export class InvalidCredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCredentialsError";
  }
}

const DEFAULT_BASE_URL = "https://api.aethis.ai";
type ConfigMap = Record<string, unknown>;
function isMap(value: unknown): value is ConfigMap {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readCredentials(suffix = ""): Promise<ConfigMap | undefined> {
  const credsPath = await safeCredentialsPath(suffix);
  if (!credsPath) return undefined;
  const info = await stat(credsPath);
  const mode = info.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new UnsafeCredentialsError(
      `Permissions 0${mode.toString(8).padStart(3, "0")} for '${credsPath}' are too open. ` +
      `Run: chmod 600 ${credsPath}`,
    );
  }
  // Never surface parser diagnostics: they can contain the secret source line.
  const document = parseDocument(await readFile(credsPath, "utf-8"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new InvalidCredentialsError("Invalid Aethis credentials YAML. Fix the credentials file and restart.");
  }
  let raw: unknown;
  try { raw = document.toJS({ maxAliasCount: 100 }); } catch {
    throw new InvalidCredentialsError("Invalid Aethis credentials YAML. Fix the credentials file and restart.");
  }
  if (!isMap(raw)) {
    throw new InvalidCredentialsError("Aethis credentials must be a YAML mapping. Fix the credentials file and restart.");
  }
  return raw;
}

function optionalString(profile: ConfigMap, field: string): string | undefined {
  const value = profile[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidCredentialsError(`The selected Aethis profile has an invalid ${field}. Fix it and restart.`);
  }
  return value.trim();
}

export interface ResolvedCredentials {
  apiKey: string;
  baseUrl: string;
  /** Non-secret provenance, safe to report on stderr. */
  source: "environment" | "profile" | "legacy-file" | "keychain" | "anonymous";
}

/**
 * Resolve the full key/endpoint pair. Missing keys are valid anonymous startup;
 * missing explicitly selected profiles and malformed/unsafe files are refusals.
 * A configured profile never borrows a key from another credential source.
 */
export async function resolveCredentials(): Promise<ResolvedCredentials> {
  const explicitProfile = process.env.AETHIS_PROFILE;
  if (explicitProfile !== undefined && !explicitProfile.trim()) {
    throw new InvalidCredentialsError("AETHIS_PROFILE must name a profile. Fix the MCP process environment and restart.");
  }
  const selectedName = explicitProfile?.trim();
  const envKey = fromEnvVar();
  const envBaseUrl = process.env.AETHIS_BASE_URL?.trim() || undefined;
  // A complete explicit environment pair needs no unrelated credential store.
  if (envKey && envBaseUrl && selectedName === undefined) {
    return { apiKey: envKey, baseUrl: envBaseUrl, source: "environment" };
  }
  const raw = await readCredentials();
  let profileName = selectedName || "default";
  let profile: ConfigMap | undefined;
  let source: ResolvedCredentials["source"] = "profile";
  if (raw) {
    if ("profiles" in raw) {
      if (!isMap(raw.profiles)) {
        throw new InvalidCredentialsError("Aethis credentials profiles must be a YAML mapping. Fix it and restart.");
      }
      if (!selectedName && raw.active_profile !== undefined) {
        const active = optionalString(raw, "active_profile");
        profileName = active || "default";
      }
      const value = Object.hasOwn(raw.profiles, profileName) ? raw.profiles[profileName] : undefined;
      if (value !== undefined) {
        if (!isMap(value)) {
          throw new InvalidCredentialsError("The selected Aethis profile must be a YAML mapping. Fix it and restart.");
        }
        profile = value;
      }
      if (!profile && profileName !== "anonymous") {
        throw new InvalidCredentialsError("The selected Aethis profile is missing. Run 'aethis profile list', select a stored profile, and restart.");
      }
    } else {
      source = "legacy-file";
      if (profileName === "default" && ("api_key" in raw || "base_url" in raw)) profile = raw;
    }
  }
  if (!profile && selectedName && profileName !== "anonymous") {
    throw new InvalidCredentialsError("The explicitly selected Aethis profile is missing. Save it with 'aethis login' or select a stored profile and restart.");
  }
  if (profileName === "anonymous") {
    return { apiKey: "", baseUrl: envBaseUrl || (profile && optionalString(profile, "base_url")) || DEFAULT_BASE_URL, source: "anonymous" };
  }
  if (profile) {
    const authMode = optionalString(profile, "auth_mode");
    if (authMode && authMode !== "api_key") {
      throw new InvalidCredentialsError("The selected Aethis profile uses an authentication mode unsupported by this MCP server. Select an API-key profile and restart.");
    }
    const key = optionalString(profile, "api_key");
    const endpoint = optionalString(profile, "base_url");
    return { apiKey: envKey || key || "", baseUrl: envBaseUrl || endpoint || DEFAULT_BASE_URL, source: envKey ? "environment" : source };
  }
  if (envKey) return { apiKey: envKey, baseUrl: envBaseUrl || DEFAULT_BASE_URL, source: "environment" };
  const keychainKey = await fromKeychain();
  if (keychainKey) return { apiKey: keychainKey, baseUrl: envBaseUrl || DEFAULT_BASE_URL, source: "keychain" };
  const legacy = await readCredentials(".yaml");
  if (legacy) {
    return { apiKey: optionalString(legacy, "api_key") || "", baseUrl: envBaseUrl || optionalString(legacy, "base_url") || DEFAULT_BASE_URL, source: "legacy-file" };
  }
  return { apiKey: "", baseUrl: envBaseUrl || DEFAULT_BASE_URL, source: "anonymous" };
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

/** Backwards-compatible key-only API; new clients must resolve the full pair. */
export async function resolveApiKey(): Promise<string> {
  const credentials = await resolveCredentials();
  if (credentials.apiKey) return credentials.apiKey;
  throw new Error(
    "No Aethis API key found. Run 'aethis login' to store your API key, or set AETHIS_API_KEY. " +
    "Decision tools work without authentication.",
  );
}
