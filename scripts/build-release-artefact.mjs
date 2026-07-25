#!/usr/bin/env node
/**
 * Build the immutable release candidate — the artefact P10 gates before any
 * publication (aethis-mcp#66 steps 3 & 4).
 *
 * This job runs with NO publish credentials. It produces, under
 * release-artefacts/ (gitignored):
 *
 *   - <tarball>.tgz      the exact npm tarball (`npm pack`)
 *   - sbom.cdx.json      a CycloneDX 1.5 SBOM derived from package-lock.json
 *   - candidate.json     the candidate manifest: identity + integrity digests +
 *                        git commit + tool-inventory digest + SBOM digest
 *
 * The sha256 of the tarball is printed as `tarball_sha256=<hex>` and (under
 * GitHub Actions) written to $GITHUB_OUTPUT, so the workspace P10 gate can pin
 * the exact immutable artefact before publication approves.
 *
 * Non-interactive; bounded; prints no secrets. Requires a prior `npm run build`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release-artefacts");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 120_000, ...opts });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// --- Preconditions: dist built, generated artefacts in sync ---------------
if (!existsSync(join(root, "dist", "index.js"))) {
  console.error("dist/index.js missing — run 'npm run build' first.");
  process.exit(2);
}
run("node", ["scripts/sync-server-json.mjs", "--check"]);
run("node", ["scripts/gen-tool-inventory.mjs", "--check"]);

mkdirSync(outDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const gitCommit = run("git", ["rev-parse", "HEAD"]).trim();

// --- npm pack (the exact published tarball) --------------------------------
const packOut = run("npm", ["pack", "--json", "--pack-destination", outDir]);
const packed = JSON.parse(packOut)[0];
const tarballPath = join(outDir, packed.filename);
const tarballBuf = readFileSync(tarballPath);
const tarballSha256 = sha256(tarballBuf);

// --- SBOM (CycloneDX 1.5) from package-lock.json ---------------------------
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const components = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === "") continue; // the root package itself
  const name = entry.name ?? path.replace(/^node_modules\//, "").split("/node_modules/").pop();
  if (!name || !entry.version) continue;
  const purl = `pkg:npm/${name.replace("@", "%40")}@${entry.version}`;
  const comp = { type: "library", name, version: entry.version, purl };
  if (entry.integrity) {
    const [alg, b64] = entry.integrity.split("-");
    const algMap = { sha512: "SHA-512", sha256: "SHA-256", sha1: "SHA-1" };
    if (algMap[alg]) comp.hashes = [{ alg: algMap[alg], content: Buffer.from(b64, "base64").toString("hex") }];
  }
  components.push(comp);
}
components.sort((a, b) => a.purl.localeCompare(b.purl));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  metadata: {
    component: { type: "application", name: pkg.name, version: pkg.version, purl: `pkg:npm/${pkg.name}@${pkg.version}` },
    properties: [{ name: "aethis:git_commit", value: gitCommit }],
  },
  components,
};
const sbomStr = JSON.stringify(sbom, null, 2) + "\n";
const sbomPath = join(outDir, "sbom.cdx.json");
writeFileSync(sbomPath, sbomStr);

// --- Candidate manifest ----------------------------------------------------
const inventoryStr = readFileSync(join(root, "tool-inventory.json"), "utf8");
const serverJsonStr = readFileSync(join(root, "server.json"), "utf8");
const candidate = {
  name: pkg.name,
  mcp_name: pkg.mcpName,
  version: pkg.version,
  git_commit: gitCommit,
  built_at: new Date().toISOString(),
  tarball: {
    filename: packed.filename,
    sha256: tarballSha256,
    // npm's own SRI (sha512) and legacy shasum, as reported by `npm pack`.
    npm_integrity: packed.integrity,
    npm_shasum: packed.shasum,
    unpacked_size: packed.unpackedSize,
    file_count: packed.entryCount,
  },
  sbom: { filename: basename(sbomPath), format: "CycloneDX/1.5", sha256: sha256(sbomStr), component_count: components.length },
  tool_inventory: { filename: "tool-inventory.json", sha256: sha256(inventoryStr) },
  server_json: { filename: "server.json", sha256: sha256(serverJsonStr) },
};
const candidatePath = join(outDir, "candidate.json");
writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + "\n");

// --- Report (and GitHub Actions output) ------------------------------------
console.log(`Release candidate built for ${pkg.name}@${pkg.version} (commit ${gitCommit.slice(0, 12)})`);
console.log(`  tarball:      ${packed.filename}`);
console.log(`  tarball_sha256=${tarballSha256}`);
console.log(`  npm_integrity: ${packed.integrity}`);
console.log(`  sbom:         ${basename(sbomPath)} (${components.length} components)`);
console.log(`  candidate:    ${basename(candidatePath)}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `tarball=${packed.filename}\ntarball_sha256=${tarballSha256}\nnpm_integrity=${packed.integrity}\nversion=${pkg.version}\n`,
  );
}
