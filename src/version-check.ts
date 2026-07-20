/**
 * Startup update-check nudge for aethis-mcp.
 *
 * Compares the installed package version against the npm registry's `latest`
 * dist-tag and, if newer, produces a one-line nudge (with a changelog
 * pointer) for the caller to write to stderr. Modelled on the CLI's
 * update_check.py (aethis-cli/aethis_cli/update_check.py): bounded timeout,
 * fail-silent on any error, opt-out via AETHIS_DISABLE_UPDATE_CHECK.
 *
 * Cadence note: an MCP host (Claude Desktop, Cursor, Windsurf, Claude Code)
 * launches this server once and keeps the process running for the whole
 * session/host-lifetime rather than invoking it per-command — unlike the
 * CLI, which runs and exits every invocation. A single check at process
 * startup is therefore the right cadence here; there is no cache-file
 * equivalent to the CLI's 24h TTL because a rare, long-lived process
 * doesn't need one.
 */

const NPM_LATEST_URL = "https://registry.npmjs.org/aethis-mcp/latest";
const FETCH_TIMEOUT_MS = 3_000;
const DISABLE_ENV = "AETHIS_DISABLE_UPDATE_CHECK";
const RELEASES_URL = "https://github.com/Aethis-ai/aethis-mcp/releases";

type FetchFn = typeof globalThis.fetch;

const VERSION_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/** Loose semver-ish tuple parse; mirrors the CLI's _parse_version. */
function parseVersion(v: string): [number, number, number] {
  const m = VERSION_RE.exec(v.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** True when `latest` is strictly newer than `current` (loose semver compare). */
export function isNewer(latest: string, current: string): boolean {
  if (!latest || !current) return false;
  if (latest === current) return false;
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Opt-out: the env var mirroring the CLI's, plus a CI skip (no one needs the nudge in a build log). */
export function shouldSkipUpdateCheck(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[DISABLE_ENV]) || Boolean(env.CI);
}

export function formatUpdateNudge(current: string, latest: string): string {
  return `[aethis-mcp] A new version is available: ${current} → ${latest}. What's new: ${RELEASES_URL}`;
}

/**
 * Fetch the npm `latest` dist-tag version, bounded by a short timeout.
 * Returns null on any failure (network, timeout, non-200, malformed body) —
 * never throws.
 */
export async function fetchLatestNpmVersion(
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const resp = await fetchFn(NPM_LATEST_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { version?: unknown };
    return typeof data.version === "string" && data.version ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Check for an update and return the nudge line to print, or null if none is
 * warranted (up to date, opted out, or the check itself failed). Never
 * throws — a failed check is indistinguishable from "no update available".
 */
export async function checkForUpdate(
  currentVersion: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<string | null> {
  if (shouldSkipUpdateCheck(env)) return null;
  try {
    const latest = await fetchLatestNpmVersion(fetchFn);
    if (latest && isNewer(latest, currentVersion)) {
      return formatUpdateNudge(currentVersion, latest);
    }
  } catch {
    // Belt-and-braces: fetchLatestNpmVersion already fail-silents, but a
    // version-check bug must never propagate into server startup.
  }
  return null;
}

/**
 * Fire-and-forget startup nudge: runs the check in the background and
 * writes the result to stderr if warranted. The caller must NOT await this
 * — it must never delay `server.connect()` / MCP readiness.
 */
export function runStartupUpdateCheck(currentVersion: string): void {
  void checkForUpdate(currentVersion)
    .then((nudge) => {
      if (!nudge) return;
      try {
        process.stderr.write(nudge + "\n");
      } catch {
        // Nothing more to do if stderr itself is unwritable.
      }
    })
    .catch(() => {
      // Belt-and-braces: checkForUpdate is already fully fail-silent, so
      // there's no reachable rejection today — this guards against a
      // future refactor accidentally introducing one and taking down the
      // host with an unhandled rejection.
    });
}
