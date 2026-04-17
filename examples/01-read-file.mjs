#!/usr/bin/env node
// Example 01: Read a single file from a git repo without full clone.
//
// Run: GH_TOKEN=$(gh auth token) node examples/01-read-file.mjs
//
// Replace the REPO_URL with your own public repo if you don't have gh.

import { CtxGitRepo } from "../src/index.mjs";

const REPO_URL = process.env.REPO_URL || "https://github.com/MauricioPerera/memory-poc";
const PATH = process.env.PATH_ARG || "user-profile.md";

const repo = new CtxGitRepo(REPO_URL, { token: process.env.GH_TOKEN });

console.log(`Reading ${PATH} from ${REPO_URL} ...`);
const t1 = performance.now();
const content = await repo.readFile(PATH);
const t2 = performance.now();

console.log(`\nTime: ${(t2 - t1).toFixed(0)}ms`);
console.log(`Size: ${content.length} chars\n`);
console.log("--- Content ---");
console.log(content);
