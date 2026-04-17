#!/usr/bin/env node
// Test write path: write a new file, commit, push to GitHub.

import { execFileSync } from "node:child_process";
import { CtxGitRepo } from "./src/index.mjs";

const REPO_URL = "https://github.com/MauricioPerera/memory-poc";

function getGhCliToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const token = process.env.GH_TOKEN || getGhCliToken();

console.log("=== Write path test ===\n");

const repo = new CtxGitRepo(REPO_URL, { token });
await repo.init();
await repo.hydrateStructure();

console.log(`HEAD before: ${repo.headOid}`);
console.log(`Tree before: ${repo.headTreeOid}`);
console.log(`Files before:`);
for (const f of repo.listFiles()) {
  console.log(`  ${f.path}  (${f.oid.slice(0, 10)})`);
}

const now = new Date().toISOString();
const newContent = `# Write test

Generated at ${now}
Random: ${Math.random().toString(36).slice(2)}
`;

const path = `writes/test-${Date.now()}.md`;
console.log(`\nWriting: ${path}`);
console.log(`Content: ${newContent.length} chars`);

const t1 = performance.now();
const result = await repo.writeFile(path, newContent, {
  message: `ctx-git write test: ${path}`,
  author: { name: "ctx-git-bot", email: "bot@ctx-git.local" },
});
const t2 = performance.now();

console.log("\n=== Result ===");
console.log(JSON.stringify(result, null, 2));
console.log(`\nTotal wall time: ${(t2 - t1).toFixed(0)}ms`);

if (result.ok) {
  console.log("\n✅ Push succeeded");
  console.log(`   New commit: ${result.commitOid}`);
  console.log(`   View on GitHub: https://github.com/MauricioPerera/memory-poc/commit/${result.commitOid}`);

  // Verify by re-reading
  console.log("\n=== Verify: re-read the file ===");
  const repo2 = new CtxGitRepo(REPO_URL, { token });
  await repo2.init();
  const readBack = await repo2.readFile(path);
  console.log(`Read back ${readBack.length} chars:`);
  console.log(readBack);
  console.log(readBack === newContent ? "✅ content matches" : "❌ content mismatch");
} else {
  console.log("\n❌ Push failed");
  console.log(JSON.stringify(result.refs, null, 2));
}
