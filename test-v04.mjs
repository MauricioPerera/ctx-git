#!/usr/bin/env node
// Test v0.4: multi-file commits, delete, branches, retry.

import { execFileSync } from "node:child_process";
import { CtxGitRepo } from "./src/index.mjs";

const REPO_URL = "https://github.com/MauricioPerera/memory-poc";
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();

const author = { name: "ctx-git-bot", email: "bot@ctx-git.local" };

// ----------------------------------------------------------------------
// Test 1: Multi-file commit
// ----------------------------------------------------------------------
console.log("=== Test 1: Multi-file commit ===");
{
  const repo = new CtxGitRepo(REPO_URL, { token });
  const now = Date.now();
  const r = await repo.writeFiles(
    [
      { path: `writes/multi-${now}-a.md`, content: `# File A at ${now}\n` },
      { path: `writes/multi-${now}-b.md`, content: `# File B at ${now}\n` },
      { path: `writes/multi-${now}-c.md`, content: `# File C at ${now}\n` },
    ],
    { message: "multi-file commit test", author },
  );
  console.log(`  ok=${r.ok}, commit=${r.commitOid?.slice(0, 10)}`);
  console.log(`  newObjects: ${r.newObjects?.length} (expected 5: 3 blobs + 1 tree + 1 commit)`);
  console.log(`  packfileBytes: ${r.packfileBytes}`);
}

// ----------------------------------------------------------------------
// Test 2: Delete file
// ----------------------------------------------------------------------
console.log("\n=== Test 2: Delete a file ===");
{
  const repo = new CtxGitRepo(REPO_URL, { token });
  // First create a file to delete
  const now = Date.now();
  const pathToDelete = `writes/delete-me-${now}.md`;

  console.log(`  Step A: Create ${pathToDelete}`);
  const r1 = await repo.writeFile(
    pathToDelete,
    "# Will be deleted\n",
    { message: "create file to delete", author },
  );
  console.log(`    ok=${r1.ok}, commit=${r1.commitOid?.slice(0, 10)}`);

  console.log(`  Step B: Delete ${pathToDelete}`);
  const r2 = await repo.deleteFile(pathToDelete, {
    message: "delete test file",
    author,
  });
  console.log(`    ok=${r2.ok}, commit=${r2.commitOid?.slice(0, 10)}`);

  // Verify it's gone
  console.log(`  Step C: Verify it's gone`);
  const repo2 = new CtxGitRepo(REPO_URL, { token });
  await repo2.init();
  await repo2.hydrateStructure();
  const files = repo2.listFiles();
  const stillThere = files.some((f) => f.path === pathToDelete);
  console.log(`    Still there? ${stillThere ? "❌ YES (bug)" : "✅ NO (deleted)"}`);
}

// ----------------------------------------------------------------------
// Test 3: List branches
// ----------------------------------------------------------------------
console.log("\n=== Test 3: List branches ===");
{
  const repo = new CtxGitRepo(REPO_URL, { token });
  const branches = await repo.listBranches();
  console.log(`  Found ${branches.length} branches:`);
  for (const b of branches) {
    console.log(`    - ${b.name}: ${b.oid.slice(0, 10)}`);
  }
}

// ----------------------------------------------------------------------
// Test 4: Create branch + write to it
// ----------------------------------------------------------------------
console.log("\n=== Test 4: Create branch + write to it ===");
{
  const repo = new CtxGitRepo(REPO_URL, { token });
  await repo.init();
  const branchName = `test-branch-${Date.now()}`;

  console.log(`  Creating branch: ${branchName}`);
  const createResult = await repo.createBranch(branchName);
  console.log(`    ok=${createResult.ok}, points to ${createResult.pointsTo.slice(0, 10)}`);

  if (createResult.ok) {
    // Now write to the new branch
    console.log(`  Writing to branch: ${branchName}`);
    const branchRepo = new CtxGitRepo(REPO_URL, { token, branch: branchName });
    const r = await branchRepo.writeFile(
      `branches/${branchName}-file.md`,
      `# File on ${branchName}\nCreated at ${new Date().toISOString()}\n`,
      { message: `initial commit on ${branchName}`, author },
    );
    console.log(`    ok=${r.ok}, commit=${r.commitOid?.slice(0, 10)}`);

    // Delete the branch (cleanup)
    console.log(`  Cleanup: delete branch ${branchName}`);
    const delResult = await repo.deleteBranch(branchName);
    console.log(`    ok=${delResult.ok}`);
  }
}

console.log("\n=== All tests complete ===");
