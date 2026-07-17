/**
 * Mint a real, self-serve staging API key for the integration lane — the same
 * path a developer's dashboard uses: a Clerk test-user JWT → POST
 * `/api/v1/keys/` with no `scopes` field, so the server default set applies.
 * Every minted key is named `e2e-dx-mcp-<runid>` and revoked in teardown; a
 * sweeper clears crash residue. Staging only, never production.
 *
 * SECURITY: the sign-in ticket, the JWT, and the full key are secrets — never
 * log them, never write them to the run record.
 */

const CLERK_BACKEND_API = "https://api.clerk.com/v1";
const CLERK_FRONTEND_API = process.env.CLERK_FRONTEND_API ?? "https://clerk.aethis.ai";
const CLERK_ORIGIN = process.env.CLERK_ORIGIN ?? "https://aethis.ai";
export const STAGING_API =
  process.env.AETHIS_BASE_URL ?? "https://staging.api.aethis.ai";

const KEY_PREFIX = "e2e-dx-mcp-";

export interface MintedKey {
  fullKey: string;
  keyId: string;
  name: string;
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Integration lane requires ${name} but it is unset. ` +
        `This lane fails loud rather than skipping.`,
    );
  }
  return v;
}

export function integrationSecretsPresent(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY_DEV_TOOLS?.trim() &&
      process.env.CLERK_E2E_DX_USER_ID?.trim(),
  );
}

async function signInTokenForUser(secret: string, userId: string): Promise<string> {
  const resp = await fetch(`${CLERK_BACKEND_API}/sign_in_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Clerk sign_in_tokens failed: HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
  }
  const body = (await resp.json()) as { token?: string };
  if (!body.token) throw new Error("Clerk sign_in_tokens returned no token");
  return body.token;
}

async function jwtFromTicket(ticket: string): Promise<string> {
  // Frontend API in BROWSER mode: form-encoded ticket strategy, an Origin
  // header, and NO `_is_native`. The completed sign-in carries the session JWT.
  const form = new URLSearchParams({ strategy: "ticket", ticket });
  const resp = await fetch(`${CLERK_FRONTEND_API}/v1/client/sign_ins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: CLERK_ORIGIN,
    },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Clerk sign_ins failed: HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
  }
  const body = (await resp.json()) as {
    client?: { sessions?: Array<{ last_active_token?: { jwt?: string } }> };
  };
  const jwt = body.client?.sessions?.[0]?.last_active_token?.jwt;
  if (!jwt) throw new Error("Clerk sign_ins returned no session JWT");
  return jwt;
}

async function staffJwt(): Promise<string> {
  const secret = requireEnv("CLERK_SECRET_KEY_DEV_TOOLS");
  const userId = requireEnv("CLERK_E2E_DX_USER_ID");
  const ticket = await signInTokenForUser(secret, userId);
  return jwtFromTicket(ticket);
}

function runId(): string {
  return (
    process.env.GITHUB_RUN_ID ??
    `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

/** Mint a fresh staging key via the self-serve path (server-default scopes). */
export async function mintStagingKey(): Promise<{ key: MintedKey; jwt: string }> {
  const jwt = await staffJwt();
  const name = `${KEY_PREFIX}${runId()}`;
  const resp = await fetch(`${STAGING_API}/api/v1/keys/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    // No `scopes` field: the server default set applies.
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Key mint failed: HTTP ${resp.status} ${await resp.text().catch(() => "")}`);
  }
  const body = (await resp.json()) as { full_key?: string; key_id?: string };
  if (!body.full_key || !body.key_id) {
    throw new Error("Key mint response missing full_key/key_id");
  }
  return { key: { fullKey: body.full_key, keyId: body.key_id, name }, jwt };
}

/** Revoke a single minted key (teardown). Best-effort; logs but never throws. */
export async function revokeKey(jwt: string, keyId: string): Promise<void> {
  try {
    const resp = await fetch(`${STAGING_API}/api/v1/keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok && resp.status !== 404) {
      console.warn(`[mint] revoke of ${keyId} returned HTTP ${resp.status}`);
    }
  } catch (err) {
    console.warn(`[mint] revoke of ${keyId} errored: ${(err as Error).message}`);
  }
}

/** Sweep any stray `e2e-dx-mcp-*` keys left by crashed prior runs. */
export async function sweepStrayKeys(jwt: string, exceptKeyId?: string): Promise<number> {
  let swept = 0;
  try {
    const resp = await fetch(`${STAGING_API}/api/v1/keys/`, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return 0;
    const body = (await resp.json()) as unknown;
    const list = Array.isArray(body)
      ? body
      : ((body as { keys?: unknown[] }).keys ?? (body as { data?: unknown[] }).data ?? []);
    for (const item of list as Array<Record<string, unknown>>) {
      const name = String(item.name ?? "");
      const id = String(item.key_id ?? item.id ?? "");
      if (name.startsWith(KEY_PREFIX) && id && id !== exceptKeyId) {
        await revokeKey(jwt, id);
        swept++;
      }
    }
  } catch (err) {
    console.warn(`[mint] sweep errored: ${(err as Error).message}`);
  }
  return swept;
}

/** Pick a public, non-immigration showcase ruleset slug at runtime. */
export async function discoverShowcaseSlug(): Promise<string> {
  const resp = await fetch(`${STAGING_API}/api/v1/public/rulesets?limit=50`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`discover showcase rulesets: HTTP ${resp.status}`);
  const body = (await resp.json()) as unknown;
  const items = (
    Array.isArray(body)
      ? body
      : ((body as { rulesets?: unknown[] }).rulesets ??
          (body as { items?: unknown[] }).items ??
          [])
  ) as Array<Record<string, unknown>>;
  const IMMIGRATION = /form-an|naturalis|immigration|english|life-uk|liuk|citizenship/i;
  const withSlug = items
    .map((r) => String(r.slug ?? ""))
    .filter((s) => s && !IMMIGRATION.test(s));
  const preferred = withSlug.find((s) => /spacecraft/.test(s)) ?? withSlug.find((s) => /fsm/.test(s));
  const slug = preferred ?? withSlug[0];
  if (!slug) throw new Error("no non-immigration public showcase ruleset found on staging");
  return slug;
}
