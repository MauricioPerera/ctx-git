#!/usr/bin/env node
// Regression test for bug #1: stale headTreeOid after write.
//
// Before the fix: after writeFile, readFile returns content from the PRE-write tree.
// After the fix: readFile returns the content we just wrote.

import { execFileSync } from "node:child_process";
import { CtxGitRepo } from "./src/index.mjs";

const REPO_URL = "https://github.com/MauricioPerera/memory-poc";
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();

console.log("=== Regression #1: stale headTreeOid ===\n");

const repo = new CtxGitRepo(REPO_URL, { token });

const path = `writes/regression-stale-${Date.now()}.md`;
const freshContent = `# Regression test\n\nWritten at ${new Date().toISOString()}\nRandom: ${Math.random()}\n`;

console.log(`Step 1: write ${path}`);
const writeResult = await repo.writeFile(path, freshContent, {
  message: "regression test: write then read",
  author: { name: "bot", email: "bot@ctx-git.local" },
});
console.log(`  commit: ${writeResult.commitOid}`);
console.log(`  headOid after write: ${repo.headOid}`);
console.log(`  headTreeOid after write: ${repo.headTreeOid}`);

console.log(`\nStep 2: readFile on the SAME instance (without reinit)`);
const readBack = await repo.readFile(path);

console.log(`\nExpected:\n${freshContent}`);
console.log(`Got:\n${readBack}`);

if (readBack === freshContent) {
  console.log("\n✅ PASS — readFile returned freshly written content");
} else {
  console.log("\n❌ FAIL — readFile returned stale content (bug #1 not fixed)");
  process.exit(1);
}

console.log("\n=== Regression #3: empty operations (edge case sanity) ===\n");
// This doesn't exercise the full "empty root" case but sanity-checks deletes
// don't break normal writes.
const path2 = `writes/regression-sanity-${Date.now()}.md`;
const r2 = await repo.writeFiles(
  [
    { path: path2, content: "hello" },
    { path: "some-file-that-does-not-exist.md", delete: true },
  ],
  {
    message: "regression: write + delete-nonexistent",
    author: { name: "bot", email: "bot@ctx-git.local" },
  },
);
console.log(`  ok=${r2.ok}, commit=${r2.commitOid?.slice(0, 10)}`);
if (r2.ok) {
  console.log("✅ PASS");
} else {
  console.log("❌ FAIL");
  process.exit(1);
}
