#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { CtxGitRepo } from "./src/index.mjs";

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
const repo = new CtxGitRepo("https://github.com/MauricioPerera/memory-poc", { token });

console.log("=== readMap() full repo ===\n");
const t1 = performance.now();
const map = await repo.readMap({ maxDepth: 3 });
const t2 = performance.now();

console.log(`Time: ${(t2 - t1).toFixed(0)}ms`);
console.log(`\n--- Tree (formatted for LLM) ---\n`);
console.log(CtxGitRepo.formatMap(map));

console.log("\n=== readMap() starting at /decisions with maxDepth=2 ===\n");
const t3 = performance.now();
const decisionsMap = await repo.readMap({ rootPath: "decisions", maxDepth: 2 });
const t4 = performance.now();
console.log(`Time: ${(t4 - t3).toFixed(0)}ms`);
console.log(`\n--- Subtree ---\n`);
console.log(CtxGitRepo.formatMap(decisionsMap));

console.log("\n=== Agent simulation: user asks 'what decisions did we make on product direction?' ===\n");
// Step 1: Read root memory
const rootMap = await repo.readMap({ maxDepth: 1 });
console.log("Agent sees at root:");
console.log(CtxGitRepo.formatMap(rootMap));
console.log("→ /decisions is relevant, navigate deeper\n");

// Step 2: Navigate into /decisions
const decisionsDetails = await repo.readMap({ rootPath: "decisions", maxDepth: 2 });
console.log("Agent sees at /decisions:");
console.log(CtxGitRepo.formatMap(decisionsDetails));
console.log("→ /decisions/2026-04-16/product-direction.md matches\n");

// Step 3: Read the specific file
const content = await repo.readFile("decisions/2026-04-16/product-direction.md");
console.log("Agent reads the file:");
console.log("---");
console.log(content.slice(0, 500));
console.log("...\n");

console.log("=== Summary ===");
console.log("Navigation cost: 3 reads (memory.md x2 + final file)");
console.log("Total content transferred: well under 10KB");
console.log("No full repo clone, no embeddings, no external index");
