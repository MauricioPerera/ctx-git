# ctx-git

**Tiny git client for AI agents** — lazy-hydration reads + commit/push from any runtime. Zero dependencies. Works in Cloudflare Workers, Node 18+, browsers, Deno.

Built specifically for agents that store their **context** (memory, decisions, skills) in git repositories. Not optimized for typical git workflows (no merges, no rebases, no diffs) — optimized for the read-blob-by-path and append-commit patterns an AI agent actually needs.

## Why

Today's agent memory layers (mem0, letta, zep, ChatGPT Memory) all lock you in:
- Their database, their rules
- No versioning or branching
- Can't `git clone` your own memory
- Cloud-hosted, opaque

`ctx-git` treats agent context as what it is: **structured, versionable, forkable content**. Any git server can host it (GitHub, GitLab, Gitea, Cloudflare Artifacts, self-hosted). You own the data — `git clone` it, fork it, delete it, migrate it.

## Features

- 🪶 **~1,300 lines**, zero runtime dependencies
- ⚡ **Partial clone via `filter=blob:none`** — download trees only, fetch blobs on demand
- ✍️ **Full commit + push** support (create, update, delete files)
- 🌿 **Branches** — list, create, delete, write to specific branch
- 🔁 **Concurrent safety** — retry with fresh HEAD on non-fast-forward
- 🌍 **Runtime-agnostic** — Cloudflare Workers, Node 18+, browsers (with Web Crypto + `node:zlib` polyfill), Deno
- 📦 **30 KiB / 7.8 KiB gzipped** bundle
- 🔒 **Private repos** — any git server that speaks protocol v2 + HTTP Basic auth

## What's *not* in scope

- ❌ Clone full history (we ship `depth: 1` by design)
- ❌ Merge / rebase / cherry-pick
- ❌ Delta resolution in packfile parsing (works for repos without deltas or small repos; larger repos may fail to parse)
- ❌ Git LFS
- ❌ SSH transport (HTTPS only)

If you need full git, use [`isomorphic-git`](https://isomorphic-git.org/). This library is narrower and smaller.

## Install

```bash
npm install ctx-git
```

## Quick start

```javascript
import { CtxGitRepo } from "ctx-git";

const repo = new CtxGitRepo("https://github.com/yourname/your-memory-repo", {
  token: process.env.GH_TOKEN,
});

// Read a file (lazy: only fetches what you ask for)
const profile = await repo.readFile("user/profile.md");
console.log(profile);

// Write a file
await repo.writeFile(
  "decisions/2026-04-16.md",
  "# New decision\n\nToday we chose X...",
  {
    message: "add decision 2026-04-16",
    author: { name: "agent", email: "agent@example.com" },
  },
);

// Multi-file commit
await repo.writeFiles(
  [
    { path: "context/topic-a.md", content: "..." },
    { path: "context/topic-b.md", content: "..." },
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
await branchRepo.writeFile("exploration.md", "...", { ... });
```

## Cloudflare Workers

Add this to your `wrangler.jsonc`:

```jsonc
{
  "compatibility_date": "2026-04-16",
  "compatibility_flags": ["nodejs_compat"]
}
```

`ctx-git` uses `node:zlib` (via `nodejs_compat`) for packfile decompression, and Web Crypto API (`crypto.subtle.digest`) for SHA-1 computation. Both are available in Workers runtime.

Example Worker:

```javascript
import { CtxGitRepo } from "ctx-git";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/memory") {
      const path = url.searchParams.get("path");
      const repo = new CtxGitRepo(env.REPO_URL, { token: env.GH_TOKEN });
      const content = await repo.readFile(path);
      return new Response(content);
    }

    // ...
  },
};
```

## API reference

### `new CtxGitRepo(url, options)`

- `url` — repo URL (e.g. `https://github.com/user/repo`)
- `options.token` — access token (optional for public repos)
- `options.branch` — default `"main"`

### Read path

- `await repo.init()` — discover server capabilities, resolve HEAD of the configured branch
- `await repo.hydrateStructure()` — fetch commits + trees (no blobs)
- `repo.listFiles()` — list all files in HEAD (requires hydrated structure)
- `repo.findBlobOid(path)` — find the OID of a file by path
- `await repo.readBlob(oid)` — read a blob by OID (fetches on-demand if not local)
- `await repo.readFile(path)` — convenience: fetches, walks tree, reads blob, decodes UTF-8
- `await repo.listBranches()` — list remote branches

### Write path

All write methods take `commitInfo = { message, author: { name, email } }` and optional `{ maxRetries = 3 }`.

- `await repo.writeFile(path, content, commitInfo, options?)` — write one file
- `await repo.writeFiles([{ path, content }, { path, delete: true }, ...], commitInfo, options?)` — multi-file commit
- `await repo.deleteFile(path, commitInfo, options?)` — delete one file
- `await repo.createBranch(name, fromOid?)` — create a new branch
- `await repo.deleteBranch(name)` — delete a branch

## Protocol details

`ctx-git` implements:

- **Git Smart HTTP Protocol v2** for discovery, `ls-refs`, `fetch`
- **Git Smart HTTP Protocol v1** for `git-receive-pack` (push)
- **Filter `blob:none`** — blobless clone + lazy blob hydration on demand
- **Packfile parsing** — commits, trees, blobs (not OFS_DELTA / REF_DELTA yet)
- **Packfile encoding** — for pushes (with SHA-1 trailer)
- **SHA-1** via Web Crypto API (`crypto.subtle.digest`)
- **zlib inflate/deflate** via `node:zlib`

## Benchmarks (from a Cloudflare Worker)

Against a small private GitHub repo:

| Operation | Latency |
|---|---:|
| `init()` (TCP + TLS + v2 handshake + ls-refs) | 180-300ms |
| `hydrateStructure()` (blobless fetch) | 90-200ms |
| `readFile(path)` (single-blob fetch) | 400-600ms |
| `writeFile(path, content, ...)` (commit + push) | 300-700ms |

## Roadmap

- [x] Read path (lazy hydration)
- [x] Write path (single + multi-file commits)
- [x] Delete
- [x] Branches (list, create, delete, write to specific)
- [x] Concurrent-safe retries
- [x] Worker-compatible
- [ ] OFS_DELTA / REF_DELTA resolution (needed for larger repos)
- [ ] Cloudflare Artifacts native support (when it exits private beta)
- [ ] TypeScript types (currently JSDoc, types generation via `tsc`)
- [ ] Comprehensive tests

## License

MIT © Mauricio Perera
