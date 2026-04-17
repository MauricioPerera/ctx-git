#!/usr/bin/env node
// Example 03: Multi-file atomic commit (create + update + delete in one commit).
//
// Run: GH_TOKEN=$(gh auth token) node examples/03-multi-file-commit.mjs

import { CtxGitRepo } from "../src/index.mjs";

const REPO_URL = process.env.REPO_URL || "https://github.com/MauricioPerera/memory-poc";

const repo = new CtxGitRepo(REPO_URL, { token: process.env.GH_TOKEN });

const now = Date.now();

console.log("Multi-file atomic commit: create 2 files + delete 1 (if exists)\n");

const result = await repo.writeFiles(
  [
    {
      path: `examples/multi-${now}-a.md`,
      content: `# File A\n\nCreated at ${new Date().toISOString()}\n`,
    },
    {
      path: `examples/multi-${now}-b.md`,
      content: `# File B\n\nCreated at ${new Date().toISOString()}\n`,
    },
    // Delete a file if it exists (safely ignored if not)
    {
      path: "old-file-that-probably-does-not-exist.md",
      delete: true,
    },
  ],
  {
    message: "example 03: multi-file atomic commit",
    author: { name: "ctx-git-example", email: "example@ctx-git.local" },
  },
);

console.log(`Ok: ${result.ok}`);
console.log(`Commit: ${result.commitOid}`);
console.log(`New objects: ${result.newObjects.length}`);
console.log(`Pack bytes: ${result.packfileBytes}`);
console.log(`\nAll changes landed in ONE commit:`);
console.log(`https://github.com/MauricioPerera/memory-poc/commit/${result.commitOid}`);
