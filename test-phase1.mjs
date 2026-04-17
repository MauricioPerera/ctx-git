#!/usr/bin/env node
// Phase 1 test: Protocol v2 handshake + ls-refs against GitHub.
// Validates that we can talk git's smart HTTP protocol without any git library.

import { execFileSync } from "node:child_process";
import { discoverCapabilities, lsRefs } from "./src/protocol-v2.mjs";

const REPO_URL = "https://github.com/MauricioPerera/memory-poc";

function getGhCliToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const token = process.env.GH_TOKEN || getGhCliToken();
if (!token) {
  console.error("No GitHub token");
  process.exit(1);
}

console.log("=== Phase 1: Protocol v2 Handshake + ls-refs ===\n");

// Step 1: Capability discovery
console.log("--- Step 1: discoverCapabilities ---");
const t1 = performance.now();
const caps = await discoverCapabilities(REPO_URL, { token });
const t2 = performance.now();
console.log(`Completed in ${(t2 - t1).toFixed(0)}ms`);
console.log(`Protocol version: ${caps.protocolVersion}`);
console.log(`Server agent: ${caps.agent}`);
console.log(`Capabilities (${caps.capabilities.size}):`);
for (const [name, values] of caps.capabilities) {
  if (values.length === 0) {
    console.log(`  ${name}`);
  } else {
    console.log(`  ${name}: ${values.join(", ")}`);
  }
}

// Check for critical capabilities we need
const required = ["ls-refs", "fetch"];
const missing = required.filter((c) => !caps.capabilities.has(c));
if (missing.length > 0) {
  console.error(`\n❌ Missing required capabilities: ${missing.join(", ")}`);
  process.exit(1);
}

// Check if fetch supports filter (required for blobless clone)
const fetchCap = caps.capabilities.get("fetch") || [];
const supportsFilter = fetchCap.includes("filter");
console.log(`\n✅ Protocol v2 validated`);
console.log(`✅ ls-refs supported`);
console.log(`✅ fetch supported`);
console.log(`${supportsFilter ? "✅" : "⚠️ "} fetch.filter support: ${supportsFilter ? "YES (blobless clone possible)" : "NO (fallback needed)"}`);

// Step 2: ls-refs
console.log("\n--- Step 2: lsRefs ---");
const t3 = performance.now();
const refs = await lsRefs(REPO_URL, { token });
const t4 = performance.now();
console.log(`Completed in ${(t4 - t3).toFixed(0)}ms`);
console.log(`Found ${refs.length} refs:`);
for (const ref of refs) {
  const extra = ref.symref ? ` (symref → ${ref.symref})` : "";
  console.log(`  ${ref.oid.slice(0, 10)} ${ref.refName}${extra}`);
}

// Verify we got HEAD and main
const head = refs.find((r) => r.refName === "HEAD");
const main = refs.find((r) => r.refName === "refs/heads/main");
if (head && main) {
  console.log(`\n✅ HEAD resolves to ${head.oid}`);
  console.log(`✅ refs/heads/main resolves to ${main.oid}`);
  if (head.oid === main.oid) {
    console.log(`✅ HEAD and main point to same commit`);
  }
}

console.log("\n=== Phase 1 Summary ===");
console.log(`Total time: ${(t4 - t1).toFixed(0)}ms`);
console.log("✅ Protocolo git v2 funcionando sin librerías externas");
console.log(`✅ ${caps.capabilities.size} capacidades del server descubiertas`);
console.log(`✅ ${refs.length} refs listados vía ls-refs`);
console.log(`✅ filter support: ${supportsFilter ? "YES" : "NO"}`);
console.log("");
console.log("Líneas de código: ~260 (pkt-line.mjs + protocol-v2.mjs)");
console.log("Dependencias: CERO");
console.log("");
console.log(`${supportsFilter ? "→ Listos para Phase 2: fetch con filter=blob:none" : "⚠️  El server no soporta filter, Phase 2 necesitará otro approach"}`);
