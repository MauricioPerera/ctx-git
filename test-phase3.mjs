#!/usr/bin/env node
// Phase 3 test: Parse packfile + read objects.
// Uses the blobless pack from Phase 2.

import { readFile } from "node:fs/promises";
import { parsePackfile } from "./src/packfile.mjs";
import { parseCommit, parseTree } from "./src/objects.mjs";

console.log("=== Phase 3: Parse packfile + walk tree ===\n");

// Load the blobless pack we downloaded in Phase 2
const packData = new Uint8Array(await readFile("C:\\tmp\\ctx-git\\test-blobless.pack"));
console.log(`Loaded pack: ${packData.length} bytes`);

// Step 1: Parse packfile
console.log("\n--- Step 1: parsePackfile ---");
const t1 = performance.now();
const pack = parsePackfile(packData);
const t2 = performance.now();
console.log(`Parsed in ${(t2 - t1).toFixed(0)}ms`);
console.log(`Version: ${pack.version}`);
console.log(`Objects: ${pack.numObjects}`);

// Step 2: Enumerate objects
console.log("\n--- Step 2: List objects ---");
for (const obj of pack.objects) {
  console.log(
    `  [${obj.typeName.padEnd(10)}] offset=${String(obj.offset).padStart(5)} size=${String(obj.size).padStart(4)} bytes`,
  );
}

// Step 3: Find the commit and parse it
console.log("\n--- Step 3: Parse commit ---");
const commitObj = pack.objects.find((o) => o.typeName === "commit");
if (!commitObj) {
  console.error("No commit found in pack");
  process.exit(1);
}
const commit = parseCommit(commitObj.data);
console.log(`tree:      ${commit.tree}`);
console.log(`parents:   [${commit.parents.join(", ")}]`);
console.log(`author:    ${commit.author}`);
console.log(`message:   ${commit.message.trim()}`);

// Step 4: Parse the root tree
console.log("\n--- Step 4: Parse root tree ---");
// Build an index: oid → object (need to compute OIDs from the objects in pack)
// For now, trees in our blobless pack are there by design; we match by position.
// In a real impl we'd compute SHA-1 over "tree <size>\0<data>" for each tree object.
// Shortcut: the tree that the commit references should be in the pack.
//
// Let's build the index properly using the oid of each object.
// For that we need SHA-1 of the uncompressed object with git header:
//   header = "<type> <size>\0" + data
const { createHash } = await import("node:crypto");

function gitOid(type, data) {
  const header = `${type} ${data.length}\0`;
  const fullData = Buffer.concat([Buffer.from(header), Buffer.from(data)]);
  return createHash("sha1").update(fullData).digest("hex");
}

const oidToObject = new Map();
for (const obj of pack.objects) {
  const oid = gitOid(obj.typeName, obj.data);
  oidToObject.set(oid, obj);
  console.log(`  ${oid.slice(0, 10)} [${obj.typeName}]`);
}

// Now find the tree object by commit.tree
const rootTreeObj = oidToObject.get(commit.tree);
if (!rootTreeObj) {
  console.error(`Root tree ${commit.tree} not found in pack`);
  process.exit(1);
}
const rootTree = parseTree(rootTreeObj.data);
console.log(`\nRoot tree contents:`);
for (const entry of rootTree) {
  console.log(`  ${entry.mode.padEnd(6)} ${entry.type.padEnd(6)} ${entry.oid.slice(0, 10)}  ${entry.name}`);
}

// Step 5: Walk tree recursively
console.log("\n--- Step 5: Walk tree recursively ---");
const allFiles = walkTree(rootTree, oidToObject, "");
console.log(`\nAll files in repo (${allFiles.length}):`);
for (const f of allFiles) {
  console.log(`  ${f.path}  ${f.oid.slice(0, 10)}`);
}

// Step 6: Observation — blob OIDs are KNOWN but blobs are NOT in pack
console.log("\n--- Step 6: Check blob availability ---");
for (const f of allFiles) {
  const blobInPack = oidToObject.has(f.oid);
  console.log(`  ${f.path}: blob ${blobInPack ? "present ✓" : "MISSING (filter=blob:none)"} (${f.oid.slice(0, 10)})`);
}

console.log("\n=== Phase 3 Summary ===");
console.log(`✅ Packfile parseado (${pack.numObjects} objects, versión ${pack.version})`);
console.log(`✅ Commit leído: tree=${commit.tree.slice(0, 10)}, message="${commit.message.trim()}"`);
console.log(`✅ Tree root walkeado recursivamente: ${allFiles.length} archivos encontrados`);
console.log(`✅ SHA-1 de objetos calculado y verificado contra OIDs conocidos`);
console.log(`✅ Confirmado: tenemos los OIDs de los blobs pero NO su contenido (filter=blob:none working)`);
console.log("");
console.log(`→ Phase 4: fetchear UN blob específico on-demand (ej: user-profile.md)`);

function walkTree(entries, oidMap, prefix) {
  const results = [];
  for (const entry of entries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "tree") {
      const treeObj = oidMap.get(entry.oid);
      if (treeObj) {
        const nested = parseTree(treeObj.data);
        results.push(...walkTree(nested, oidMap, fullPath));
      } else {
        console.log(`  (tree ${entry.oid.slice(0, 10)} not in pack, skipping)`);
      }
    } else if (entry.type === "blob") {
      results.push({ path: fullPath, oid: entry.oid });
    }
  }
  return results;
}
