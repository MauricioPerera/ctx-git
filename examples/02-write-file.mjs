#!/usr/bin/env node
// Example 02: Write a file (commit + push) to a git repo.
//
// Run: GH_TOKEN=$(gh auth token) node examples/02-write-file.mjs

import { CtxGitRepo } from "../src/index.mjs";

const REPO_URL = process.env.REPO_URL || "https://github.com/MauricioPerera/memory-poc";

const repo = new CtxGitRepo(REPO_URL, { token: process.env.GH_TOKEN });

const path = `examples/write-demo-${Date.now()}.md`;
const content = `# Written from ctx-git example

Timestamp: ${new Date().toISOString()}
Runtime: ${process.version}
`;

console.log(`Writing ${path} ...`);
const t1 = performance.now();
const result = await repo.writeFile(path, content, {
  message: `example 02: write ${path}`,
  author: { name: "ctx-git-example", email: "example@ctx-git.local" },
});
const t2 = performance.now();

console.log(`\nTime: ${(t2 - t1).toFixed(0)}ms`);
console.log(`Ok: ${result.ok}`);
console.log(`Commit: ${result.commitOid}`);
console.log(`Pack bytes: ${result.packfileBytes}`);
console.log(`Attempts: ${result.attempts}`);
