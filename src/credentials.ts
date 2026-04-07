/**
 * Credential resolution for Aethis API keys.
 *
 * Fallback chain (matches the Python CLI's config.resolve_api_key):
 *   1. AETHIS_API_KEY environment variable
 *   2. macOS Keychain (service: aethis-cli, account: api_key)
 *   3. ~/.config/aethis/credentials YAML file
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const KEYCHAIN_SERVICE = "aethis-cli";
const KEYCHAIN_ACCOUNT = "api_key";
const KEYCHAIN_TIMEOUT_MS = 5_000;

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

async function fromCredentialsFile(): Promise<string | undefined> {
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const credsPath = join(configDir, "aethis", "credentials");
  try {
    const content = await readFile(credsPath, "utf-8");
    const match = content.match(/^api_key:\s*(.+)$/m);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve an Aethis API key from available credential sources.
 * Throws if no key is found anywhere.
 */
export async function resolveApiKey(): Promise<string> {
  const key =
    fromEnvVar() ??
    (await fromKeychain()) ??
    (await fromCredentialsFile());

  if (key) return key;

  throw new Error(
    "No Aethis API key found. Checked:\n" +
      "  1. $AETHIS_API_KEY environment variable\n" +
      "  2. macOS Keychain (service: aethis-cli)\n" +
      "  3. ~/.config/aethis/credentials\n\n" +
      "Run 'aethis login' to store your API key, or set AETHIS_API_KEY.\n" +
      "Note: Authentication is only needed for rule authoring — decision tools work without it.",
  );
}
