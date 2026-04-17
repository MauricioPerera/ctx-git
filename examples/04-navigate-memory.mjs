#!/usr/bin/env node
// Example 04: Navigate a repo using the memory.md hierarchy pattern.
//
// Run: GH_TOKEN=$(gh auth token) node examples/04-navigate-memory.mjs

import { CtxGitRepo } from "../src/index.mjs";

const REPO_URL = process.env.REPO_URL || "https://github.com/MauricioPerera/memory-poc";

const repo = new CtxGitRepo(REPO_URL, { token: process.env.GH_TOKEN });

console.log("=== Step 1: Full map (for overview) ===\n");

const t1 = performance.now();
const fullMap = await repo.readMap({ maxDepth: 3 });
const t2 = performance.now();

console.log(CtxGitRepo.formatMap(fullMap));
console.log(`\nTime: ${(t2 - t1).toFixed(0)}ms\n`);

console.log("=== Step 2: Zoom into /decisions only ===\n");

const t3 = performance.now();
const decisionsMap = await repo.readMap({ rootPath: "decisions", maxDepth: 2 });
const t4 = performance.now();

console.log(CtxGitRepo.formatMap(decisionsMap));
console.log(`\nTime: ${(t4 - t3).toFixed(0)}ms\n`);

console.log("=== Step 3: Read a specific file found in the map ===\n");

// Find a specific file recursively
function findFile(node, filename) {
  for (const f of node.files) {
    if (f.name === filename) return f;
  }
  for (const sub of node.subfolders) {
    const found = findFile(sub, filename);
    if (found) return found;
  }
  return null;
}

const target = findFile(decisionsMap, "product-direction.md");
if (target) {
  const content = await repo.readFile(target.path);
  console.log(`Found: ${target.path}`);
  console.log(`--- Content (first 300 chars) ---`);
  console.log(content.slice(0, 300));
  console.log("...");
} else {
  console.log("product-direction.md not found (did you run the demo setup?)");
}
