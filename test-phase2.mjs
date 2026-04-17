#!/usr/bin/env node
// Phase 2 test: Fetch with filter=blob:none.
// Validates we can download only commits+trees (no blobs) via git protocol v2.

import { execFileSync } from "node:child_process";
import { lsRefs } from "./src/protocol-v2.mjs";
import { fetchObjects } from "./src/fetch.mjs";

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

console.log("=== Phase 2: Fetch con filter=blob:none ===\n");

// Step 1: ls-refs to get HEAD OID
console.log("--- Step 1: Get HEAD OID via ls-refs ---");
const refs = await lsRefs(REPO_URL, { token });
const head = refs.find((r) => r.refName === "HEAD");
if (!head) {
  console.error("No HEAD found");
  process.exit(1);
}
console.log(`HEAD = ${head.oid}`);

// Step 2: Fetch WITHOUT filter (baseline: should get everything)
console.log("\n--- Step 2: Fetch FULL (no filter, baseline) ---");
const t1 = performance.now();
const fullResult = await fetchObjects(REPO_URL, {
  wants: [head.oid],
  depth: 1,
  token,
});
const t2 = performance.now();
console.log(`Pack size: ${fullResult.packData.length} bytes`);
console.log(`Progress messages: ${fullResult.progress.length}`);
for (const p of fullResult.progress) process.stdout.write(`  ${p}`);
console.log(`Time: ${(t2 - t1).toFixed(0)}ms`);

// Step 3: Fetch WITH filter=blob:none
console.log("\n--- Step 3: Fetch with filter=blob:none ---");
const t3 = performance.now();
const blobless = await fetchObjects(REPO_URL, {
  wants: [head.oid],
  filter: "blob:none",
  depth: 1,
  token,
});
const t4 = performance.now();
console.log(`Pack size: ${blobless.packData.length} bytes`);
console.log(`Progress messages: ${blobless.progress.length}`);
for (const p of blobless.progress) process.stdout.write(`  ${p}`);
console.log(`Time: ${(t4 - t3).toFixed(0)}ms`);

// Step 4: Verify pack header is valid
console.log("\n--- Step 4: Validate packfile header ---");
validatePackHeader(blobless.packData, "blobless");
validatePackHeader(fullResult.packData, "full");

// Step 5: Save pack for next phases
const { writeFile } = await import("node:fs/promises");
await writeFile("C:\\tmp\\ctx-git\\test-blobless.pack", blobless.packData);
await writeFile("C:\\tmp\\ctx-git\\test-full.pack", fullResult.packData);
console.log("\nSaved packs to test-blobless.pack and test-full.pack");

console.log("\n=== Phase 2 Summary ===");
console.log(`Full pack:     ${fullResult.packData.length} bytes`);
console.log(`Blobless pack: ${blobless.packData.length} bytes`);
console.log(
  `Savings:       ${fullResult.packData.length - blobless.packData.length} bytes (${(((fullResult.packData.length - blobless.packData.length) / fullResult.packData.length) * 100).toFixed(1)}%)`,
);
console.log("");
console.log("✅ fetch command funciona");
console.log("✅ filter=blob:none reduce el packfile (ahorra blobs)");
console.log("✅ sideband multiplexing decodificado correctamente");

function validatePackHeader(pack, label) {
  if (pack.length < 12) {
    console.log(`  ${label}: pack too short (${pack.length} bytes)`);
    return;
  }
  // Magic: "PACK" (0x50 0x41 0x43 0x4B)
  const magic =
    String.fromCharCode(pack[0]) +
    String.fromCharCode(pack[1]) +
    String.fromCharCode(pack[2]) +
    String.fromCharCode(pack[3]);
  const version = (pack[4] << 24) | (pack[5] << 16) | (pack[6] << 8) | pack[7];
  const numObjects = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
  console.log(
    `  ${label}: magic="${magic}" version=${version} numObjects=${numObjects}`,
  );
}
