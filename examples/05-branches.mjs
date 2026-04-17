#!/usr/bin/env node
// Example 05: Branch operations — create a branch, write to it, delete it.
//
// Use case: fork user memory to explore an alternative ("what-if") scenario.
//
// Run: GH_TOKEN=$(gh auth token) node examples/05-branches.mjs

import { CtxGitRepo } from "../src/index.mjs";

const REPO_URL = process.env.REPO_URL || "https://github.com/MauricioPerera/memory-poc";

const repo = new CtxGitRepo(REPO_URL, { token: process.env.GH_TOKEN });

// List branches
console.log("=== Current branches ===");
const branches = await repo.listBranches();
for (const b of branches) {
  console.log(`  - ${b.name} @ ${b.oid.slice(0, 10)}`);
}

// Create a new branch off main
const branchName = `demo-${Date.now()}`;
console.log(`\n=== Creating branch: ${branchName} ===`);

await repo.init();
const createResult = await repo.createBranch(branchName);
console.log(`  ok: ${createResult.ok}`);
console.log(`  points to: ${createResult.pointsTo.slice(0, 10)}`);

// Write to the new branch (doesn't touch main)
if (createResult.ok) {
  console.log(`\n=== Writing to branch ${branchName} ===`);

  const branchRepo = new CtxGitRepo(REPO_URL, {
    token: process.env.GH_TOKEN,
    branch: branchName,
  });

  const writeResult = await branchRepo.writeFile(
    `what-if-scenarios/${branchName}.md`,
    `# What-if scenario

This is a branch exploration. Main branch is unaffected.

Created on branch: ${branchName}
Time: ${new Date().toISOString()}
`,
    {
      message: `explore scenario on ${branchName}`,
      author: { name: "ctx-git-example", email: "example@ctx-git.local" },
    },
  );

  console.log(`  commit: ${writeResult.commitOid}`);
  console.log(`  ok: ${writeResult.ok}`);

  // Cleanup: delete the demo branch
  console.log(`\n=== Cleaning up: deleting ${branchName} ===`);
  const deleteResult = await repo.deleteBranch(branchName);
  console.log(`  ok: ${deleteResult.ok}`);
}

// Verify main wasn't touched
console.log("\n=== Branches after demo ===");
const branchesAfter = await repo.listBranches();
for (const b of branchesAfter) {
  console.log(`  - ${b.name} @ ${b.oid.slice(0, 10)}`);
}
