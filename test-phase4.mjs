#!/usr/bin/env node
// Phase 4 test: on-demand fetch of a SINGLE blob by OID.
// Given we know the OID from the tree walk, request only that blob.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fetchObjects } from "./src/fetch.mjs";
import { parsePackfile } from "./src/packfile.mjs";
import { blobToString, parseCommit, parseTree } from "./src/objects.mjs";
import { createHash } from "node:crypto";

const REPO_URL = "https://github.com/MauricioPerera/memory-poc";

function getGhCliToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const token = process.env.GH_TOKEN || getGhCliToken();

console.log("=== Phase 4: On-demand fetch of one blob by OID ===\n");

// First, reconstruct what we'd know from the blobless clone:
// We know user-profile.md has OID d7d0a2f444c107540cf36668888fbe37395efb4a
const TARGET_BLOB_OID = "d7d0a2f444c107540cf36668888fbe37395efb4a";

console.log(`Target: user-profile.md`);
console.log(`OID:    ${TARGET_BLOB_OID}`);

// Step 1: Try to fetch JUST this blob
console.log("\n--- Step 1: fetchObjects with want=<blob-oid> ---");
console.log("(requesting only the blob, with filter=blob:none to avoid collateral)");

const t1 = performance.now();
const result = await fetchObjects(REPO_URL, {
  wants: [TARGET_BLOB_OID],
  filter: "blob:none", // don't pull other blobs, only the one we asked for
  token,
});
const t2 = performance.now();

console.log(`Fetch time: ${(t2 - t1).toFixed(0)}ms`);
console.log(`Pack size:  ${result.packData.length} bytes`);
for (const p of result.progress) process.stdout.write(`  ${p}`);

// Step 2: Parse the returned pack
console.log("\n--- Step 2: Parse returned pack ---");
const pack = parsePackfile(result.packData);
console.log(`Objects in response: ${pack.numObjects}`);

function gitOid(type, data) {
  const header = `${type} ${data.length}\0`;
  const fullData = Buffer.concat([Buffer.from(header), Buffer.from(data)]);
  return createHash("sha1").update(fullData).digest("hex");
}

// Step 3: Find our blob in the returned pack
console.log("\n--- Step 3: Verify blob in pack ---");
for (const obj of pack.objects) {
  const oid = gitOid(obj.typeName, obj.data);
  const isOurTarget = oid === TARGET_BLOB_OID;
  console.log(
    `  [${obj.typeName.padEnd(6)}] ${oid.slice(0, 10)}  size=${obj.size}${isOurTarget ? "  ← TARGET" : ""}`,
  );
}

const targetBlob = pack.objects.find((o) => gitOid(o.typeName, o.data) === TARGET_BLOB_OID);
if (!targetBlob) {
  console.error("\n❌ Target blob NOT in response — GitHub may not allow direct blob fetch");
  console.error("   Fallback would be: fetch whole commit without filter, then extract");
  process.exit(1);
}

// Step 4: Decode the blob content
console.log("\n--- Step 4: Decode blob content ---");
const content = blobToString(targetBlob.data);
console.log(`Content length: ${content.length} chars`);
console.log(`Content preview (first 300 chars):`);
console.log("---");
console.log(content.slice(0, 300));
console.log("---");

console.log("\n=== Phase 4 Summary ===");
console.log(`✅ Fetch directo por blob OID funcionó`);
console.log(`✅ Pack retornado: ${result.packData.length} bytes para 1 blob de ${targetBlob.size} bytes`);
console.log(`✅ Blob decodificado correctamente`);
console.log("");
console.log("Comparación:");
console.log(`  Full clone pack: 3029 bytes (todo el repo)`);
console.log(`  Blobless pack:   457 bytes  (solo commits+trees)`);
console.log(`  Single blob:     ${result.packData.length} bytes (solo user-profile.md)`);
console.log("");
console.log("→ Phase 5: LLM integration end-to-end");
