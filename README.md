# ctx-git

**Tiny git client for AI agents** — lazy-hydration reads + commit/push + hierarchical memory navigation, from any runtime. Zero dependencies.

Works in **Cloudflare Workers**, **Node 18+**, modern **browsers**, and **Deno**.

[![npm version](https://img.shields.io/npm/v/ctx-git.svg)](https://www.npmjs.com/package/ctx-git)
[![bundle size](https://img.shields.io/bundlephobia/minzip/ctx-git)](https://bundlephobia.com/package/ctx-git)
[![license](https://img.shields.io/npm/l/ctx-git.svg)](./LICENSE)

Built specifically for **agents that store their context (memory, decisions, skills) in git repositories**. Not optimized for typical git workflows (no merges, no rebases, no diffs) — optimized for the read-blob-by-path and append-commit patterns an AI agent actually needs.

---

## Table of contents

- [Why](#why)
- [Features](#features)
- [What's *not* in scope](#whats-not-in-scope)
- [Install](#install)
- [Quick start](#quick-start)
- [The memory.md hierarchy pattern](#the-memorymd-hierarchy-pattern)
- [Cloudflare Workers deployment](#cloudflare-workers-deployment)
- [API reference](#api-reference)
- [Protocol details](#protocol-details)
- [Benchmarks](#benchmarks)
- [Roadmap](#roadmap)
- [Docs](#docs)

---

## Why

Today's agent memory layers (mem0, letta, zep, ChatGPT Memory) all lock you in:

- Their database, their rules
- No versioning or branching
- Can't `git clone` your own memory
- Cloud-hosted, opaque

`ctx-git` treats agent context as what it is: **structured, versionable, forkable content**. Any git server can host it (GitHub, GitLab, Gitea, Cloudflare Artifacts, self-hosted). You own the data — `git clone` it, fork it, delete it, migrate it.

---

## Features

- 🪶 **~1,500 lines**, zero runtime dependencies
- ⚡ **Partial clone via `filter=blob:none`** — download trees only, fetch blobs on demand
- ✍️ **Full commit + push** (create, update, delete, multi-file, atomic)
- 🌿 **Branches** — list, create, delete, write to specific branch
- 🗺️ **memory.md hierarchy** — self-describing repo layout for LLM navigation
- 🔁 **Concurrent safety** — retry with fresh HEAD on non-fast-forward
- 🌍 **Runtime-agnostic** — Cloudflare Workers, Node 18+, browsers, Deno
- 📦 **30 KiB / 7.8 KiB gzipped** bundle
- 🔒 **Private repos** — any git server that speaks protocol v2 + HTTP Basic auth

---

## What's *not* in scope

- ❌ Clone full history (we ship `depth: 1` by design)
- ❌ Merge / rebase / cherry-pick
- ❌ Delta resolution in packfile parsing (works for repos without deltas or small repos; larger repos may fail to parse)
- ❌ Git LFS
- ❌ SSH transport (HTTPS only)

If you need full git, use [`isomorphic-git`](https://isomorphic-git.org/). This library is narrower and smaller.

---

## Install

```bash
npm install ctx-git
```

---

## Quick start

```javascript
import { CtxGitRepo } from "ctx-git";

const repo = new CtxGitRepo("https://github.com/yourname/your-memory-repo", {
  token: process.env.GH_TOKEN,
});

// Read a file (lazy: only fetches what you ask for)
const profile = await repo.readFile("user/profile.md");
console.log(profile);

// Write a file (commits + pushes atomically)
await repo.writeFile(
  "decisions/2026-04-16.md",
  "# New decision\n\nToday we chose X...",
  {
    message: "add decision 2026-04-16",
    author: { name: "agent", email: "agent@example.com" },
  },
);

// Multi-file commit (atomic)
await repo.writeFiles(
  [
    { path: "context/topic-a.md", content: "..." },
    { path: "context/topic-b.md", content: "..." },
    { path: "outdated.md", delete: true },
  ],
  { message: "update context", author: { name: "agent", email: "a@b.com" } },
);

// Delete a file
await repo.deleteFile("outdated.md", {
  message: "prune outdated memory",
  author: { name: "agent", email: "agent@example.com" },
});

// Branches
const branches = await repo.listBranches();
await repo.createBranch("experiment-1");

const branchRepo = new CtxGitRepo(url, { token, branch: "experiment-1" });
await branchRepo.writeFile("exploration.md", "...", {
  message: "explore alternative",
  author: { name: "agent", email: "a@b.com" },
});

// Navigate hierarchical memory
const map = await repo.readMap({ maxDepth: 3 });
console.log(CtxGitRepo.formatMap(map));
```

---

## The memory.md hierarchy pattern

The killer feature for AI agents: a **self-describing, LLM-navigable** repo structure.

### Pattern

Each folder contains a `memory.md` that describes what's in that folder:

```
/memory.md                              ← root: general map of the repo
/profile/memory.md                      ← describes /profile/
/profile/personal.md
/profile/work.md
/decisions/memory.md                    ← describes /decisions/
/decisions/2026-04-16/memory.md         ← describes this subfolder
/decisions/2026-04-16/product-direction.md
/context/memory.md
/context/projects/memory.md
```

### Example memory.md

```markdown
# /decisions — Decision log

Chronological log of key strategic and technical decisions.

## Structure

- Subfolders by date: YYYY-MM-DD/
- Files: <topic>.md

## Recent

- 2026-04-16/product-direction.md — pivot from research to product
- 2026-04-17/memory-md-hierarchy.md — adopt this pattern

## Conventions

Each decision file includes: Context, Options, Decision, Rationale.
```

### Agent navigation flow

```javascript
// Step 1: read root memory to see top-level structure
const root = await repo.readMap({ maxDepth: 1 });

// Step 2: LLM picks relevant subfolder based on question
// "what did we decide about product direction?"
//   → /decisions looks relevant

// Step 3: recurse into chosen subfolder
const decisions = await repo.readMap({
  rootPath: "decisions",
  maxDepth: 2,
});

// Step 4: LLM picks final file → read it → answer
const content = await repo.readFile(
  "decisions/2026-04-16/product-direction.md"
);
```

### Why this works

- **Self-describing**: the repo explains itself, no external index
- **Lazy navigation**: read only the `memory.md` files along the path you need
- **Scales**: 10K files with 1K `memory.md` files still works
- **Git-native**: no embeddings, vector DB, or separate infrastructure
- **Human-readable**: browse on GitHub UI and understand the memory
- **Atomic updates**: add file + update parent `memory.md` in same commit

### `formatMap()` helper

For feeding the map to an LLM:

```javascript
const map = await repo.readMap({ rootPath: "decisions", maxDepth: 2 });
const prompt = CtxGitRepo.formatMap(map);

// Output (markdown-friendly for LLM prompts):
//
// decisions
//   ▸ Chronological log of key strategic and technical decisions
//   decisions/2026-04-16
//     ▸ Decisions made on this date
//     - product-direction.md
//     - structure-over-similarity.md
```

See [docs/memory-md-pattern.md](./docs/memory-md-pattern.md) for the full protocol + write-back conventions.

---

## Cloudflare Workers deployment

### Wrangler config

```jsonc
{
  "name": "my-agent-worker",
  "main": "worker.mjs",
  "compatibility_date": "2026-04-16",
  "compatibility_flags": ["nodejs_compat"]
}
```

`ctx-git` uses `node:zlib` (via `nodejs_compat`) for packfile decompression, and Web Crypto API (`crypto.subtle.digest`) for SHA-1. Both available in Workers.

### Example Worker

```javascript
import { CtxGitRepo } from "ctx-git";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const repo = new CtxGitRepo(env.REPO_URL, { token: env.GH_TOKEN });

    if (url.pathname === "/memory") {
      const path = url.searchParams.get("path");
      const content = await repo.readFile(path);
      return new Response(content);
    }

    if (url.pathname === "/remember" && request.method === "POST") {
      const { path, content, message } = await request.json();
      const result = await repo.writeFile(path, content, {
        message,
        author: { name: "worker", email: "bot@example.com" },
      });
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};
```

### Live demo

A reference Worker using the full feature set is deployed at:

**<https://ctx-git-worker.rckflr.workers.dev>**

Endpoints:

- `GET /` — status + endpoint list
- `GET /refs` — remote refs via protocol v2
- `GET /files` — blobless structure + file list
- `GET /map?format=text&depth=3` — hierarchical memory tree
- `GET /file?path=...` — read a specific file on-demand
- `GET /file?path=...&ask=...` — read + LLM reasoning
- `POST /file?path=...` — write a file (body = content)
- `GET /ask?q=...` — navigate memory + answer question using LLM

See [docs/worker-deployment.md](./docs/worker-deployment.md) for deployment details.

---

## API reference

### `new CtxGitRepo(url, options)`

- `url` — repo URL (e.g. `https://github.com/user/repo`)
- `options.token` — access token (optional for public repos)
- `options.branch` — default `"main"`

### Initialization

- `await repo.init()` — discover server capabilities, resolve HEAD
- `await repo.hydrateStructure()` — fetch commits + trees (no blobs)
- `await repo.listBranches()` — list remote branches

### Read path

- `repo.listFiles()` — all files in HEAD (requires hydrated structure)
- `repo.findBlobOid(path)` — find blob OID by path
- `await repo.readBlob(oid)` — read blob by OID (fetches on-demand if needed)
- `await repo.readFile(path)` — convenience: fetch → find → read → decode UTF-8

### Memory navigation

- `await repo.readMap(options)` — hierarchical map from `memory.md` files
  - `options.indexFile` — default `"memory.md"`
  - `options.rootPath` — default `""` (repo root)
  - `options.maxDepth` — default `3`
  - `options.includeFileList` — default `true`
- `CtxGitRepo.formatMap(node)` — format map tree as markdown for LLM

### Write path

All write methods take `commitInfo = { message, author: { name, email } }` and optional `{ maxRetries = 3 }`.

- `await repo.writeFile(path, content, commitInfo, options?)` — one file
- `await repo.writeFiles(operations, commitInfo, options?)` — multi-file atomic commit
  - `operations[i] = { path, content }` (create/update) OR `{ path, delete: true }` (delete)
- `await repo.deleteFile(path, commitInfo, options?)` — convenience wrapper
- `await repo.createBranch(name, fromOid?)` — create branch
- `await repo.deleteBranch(name)` — delete branch

Full JSDoc → generated TypeScript types in `types/`.

---

## Protocol details

`ctx-git` implements, by hand, no dependencies:

| Layer | Protocol |
|---|---|
| **Discovery** | Git Smart HTTP Protocol v2 `ls-refs` |
| **Read** | Git Smart HTTP Protocol v2 `fetch` with `filter=blob:none` |
| **Write** | Git Smart HTTP Protocol v1 `git-receive-pack` |
| **Pack parsing** | Commit, tree, blob objects (no delta resolution yet) |
| **Pack encoding** | Custom trees + commits + zlib deflate + SHA-1 trailer |
| **Hashing** | `crypto.subtle.digest("SHA-1", ...)` (Web Crypto API) |
| **Compression** | `node:zlib` via `nodejs_compat` flag in Workers |

See [docs/architecture.md](./docs/architecture.md) for a deeper dive into the internals.

---

## Benchmarks

Deployed Cloudflare Worker against a small private GitHub repo:

| Operation | Latency |
|---|---:|
| `init()` (TCP + TLS + v2 handshake + ls-refs) | 180-300ms |
| `hydrateStructure()` (blobless fetch) | 90-200ms |
| `readFile(path)` (single-blob fetch) | 400-600ms |
| `writeFile(path, ...)` (commit + push) | 300-700ms |
| `writeFiles([...], ...)` (multi-file atomic) | 300-800ms |
| `readMap({ maxDepth: 3 })` | 500-2000ms (depends on memory.md count) |
| Full pipeline (`/ask` with navigation + LLM) | 2-12s |

Packet size examples (small test repo):

| Operation | Bytes |
|---|---:|
| Full clone pack (everything) | 3,029 |
| Blobless pack (commits + trees only) | 457 |
| Single-blob fetch | 878 |

At scale (e.g. 100MB repo), blobless hydration is 100-1000x smaller than a full clone.

---

## Roadmap

- [x] Read path (lazy hydration)
- [x] Write path (single + multi-file commits)
- [x] Delete files
- [x] Branches (list, create, delete, write to specific)
- [x] Concurrent-safe retries
- [x] Worker-compatible (Node 18+, browsers, Deno)
- [x] Memory map (memory.md hierarchy)
- [x] TypeScript types (via JSDoc → `tsc`)
- [ ] OFS_DELTA / REF_DELTA resolution in packfile parser (larger repos)
- [ ] Cloudflare Artifacts native support (when it exits private beta)
- [ ] Comprehensive test suite (currently smoke tests only)
- [ ] `pureWeb` build (no `node:zlib` → DecompressionStream with custom stream tracking)
- [ ] File streaming for large blobs

---

## Docs

- [`docs/memory-md-pattern.md`](./docs/memory-md-pattern.md) — memory.md hierarchy protocol in depth
- [`docs/architecture.md`](./docs/architecture.md) — internal architecture + protocol details
- [`docs/worker-deployment.md`](./docs/worker-deployment.md) — Cloudflare Workers deployment guide
- [`examples/`](./examples/) — runnable examples

---

## License

MIT © Mauricio Perera
