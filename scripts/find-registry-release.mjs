#!/usr/bin/env node
/**
 * Read an official MCP Registry search response from stdin and print `yes` when
 * it contains the requested exact server name and version.
 *
 * Registry search entries wrap the published record under `entry.server`; the
 * adjacent `entry._meta` object carries publication status metadata.
 */

const expectedName = process.argv[2];
const expectedVersion = process.argv[3];

if (!expectedName || !expectedVersion) {
  console.error("usage: find-registry-release.mjs <server-name> <version>");
  process.exit(2);
}

let body = "";
for await (const chunk of process.stdin) {
  body += chunk;
}

try {
  const response = JSON.parse(body);
  const entries = Array.isArray(response.servers) ? response.servers : [];
  const found = entries.some(
    (entry) => entry?.server?.name === expectedName && entry?.server?.version === expectedVersion,
  );
  process.stdout.write(found ? "yes" : "");
} catch {
  // An empty/malformed transient response is a miss; the workflow retry loop
  // owns retries and the final loud failure.
  process.stdout.write("");
}
