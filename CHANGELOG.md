# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Roadmap
- OFS_DELTA / REF_DELTA resolution for large repos with delta-compressed packs
- Cloudflare Artifacts native support (once out of private beta)
- `pureWeb` build using `DecompressionStream` (no `node:zlib` dependency)
- Streaming API for large blobs
- Comprehensive test suite

## [0.1.1] - 2026-04-17

### Fixed

- **Stale `headTreeOid` after successful write** — after `writeFile` / `writeFiles` / `deleteFile` succeeded, subsequent `readFile` calls on the same instance could return content from the pre-write tree. Now the new tree OID is tracked and applied to local state.
- **Empty root tree edge case** — deleting the last remaining file(s) left the root tree as `null`, producing an invalid commit. Now an empty tree object (well-known OID `4b825dc642...`) is created explicitly, making repos that transition through empty-root states work correctly.
- **`hexToBytes` silently accepted invalid hex** — non-hex characters were converted to `0` via `parseInt` / `NaN`. Now throws a clear error with position info.

### Changed

- **Extracted shared utilities to `src/utils.mjs`** — removed duplication of `stripDotGit`, `bytesToHex`, `hexToBytes`, `concat`, `basicAuth`, `USER_AGENT` that previously lived in 4 different files. No public API change; all exports still accessible from their original modules for backward compatibility where applicable.
- `pkt-line.mjs` re-exports `concat` from utils for users depending on its previous export location.

### Internal

- `_prepareCommit` now returns `newRootTreeOid` alongside `newCommitOid`; consumers can update local state after successful push.
- Added regression tests `test-regression-stale-head.mjs` covering the bugs fixed in this release.

## [0.1.0] - 2026-04-17

First public release.

### Added

#### Read path
- `CtxGitRepo.init()` — discover server capabilities via Git Smart HTTP Protocol v2
- `CtxGitRepo.hydrateStructure()` — fetch commits + trees (no blobs) via `filter=blob:none`
- `CtxGitRepo.listFiles()` — list all files in HEAD tree
- `CtxGitRepo.findBlobOid(path)` — resolve a path to its blob OID
- `CtxGitRepo.readBlob(oid)` — read a blob by OID (with on-demand fetch)
- `CtxGitRepo.readFile(path)` — high-level read that does all of the above
- `CtxGitRepo.listBranches()` — list remote branches

#### Write path
- `CtxGitRepo.writeFile(path, content, commitInfo)` — single-file commit + push
- `CtxGitRepo.writeFiles(operations, commitInfo)` — multi-file atomic commits
- `CtxGitRepo.deleteFile(path, commitInfo)` — delete a file
- Automatic retry with fresh HEAD on non-fast-forward push failures (configurable via `maxRetries`)

#### Branches
- `CtxGitRepo.createBranch(name, fromOid?)` — create a branch ref
- `CtxGitRepo.deleteBranch(name)` — delete a branch ref
- Branch selection via `new CtxGitRepo(url, { branch: "..." })`

#### Memory navigation
- `CtxGitRepo.readMap(options)` — hierarchical map of repo using `memory.md` files at each level
- `CtxGitRepo.formatMap(mapNode)` — static method to format map as markdown for LLM prompts
- Supports custom index filename via `options.indexFile`
- Lazy navigation: read one level at a time for scale

#### Core primitives (internal, exported)
- `gitOid(type, data)` — compute git object OID via Web Crypto API
- `ZERO_OID` — zero OID constant for new-ref creation

### Features
- **Zero runtime dependencies** — implemented by hand: pkt-line, protocol v2, packfile parsing, SHA-1 hashing, zlib compression
- **Runtime-agnostic** — works in Cloudflare Workers (with `nodejs_compat`), Node 18+, browsers with Web Crypto, Deno
- **Compact** — ~30 KiB bundle (7.8 KiB gzipped), ~1,500 lines of code
- **TypeScript types** — generated from JSDoc via `tsc --declaration`
- **HTTPS + token auth** — works with any git server supporting Git Smart HTTP v2

### Documentation
- Full `README.md` with quick start + API reference
- `docs/memory-md-pattern.md` — hierarchical self-describing repo pattern
- `docs/architecture.md` — internals + protocol implementation details
- `docs/worker-deployment.md` — step-by-step Cloudflare Workers guide
- `examples/` — 5 runnable scripts demonstrating every feature

### Known limitations
- No delta resolution (OFS_DELTA / REF_DELTA) in packfile parser — fine for small/medium repos, breaks on some larger ones
- Requires `nodejs_compat` flag in Cloudflare Workers (uses `node:zlib`)
- HTTPS only, no SSH transport
- No merge / rebase / cherry-pick (by design — out of scope for agent memory)

### Tested against
- GitHub (public + private repos)
- Cloudflare Workers runtime
- Node.js 22

[Unreleased]: https://github.com/MauricioPerera/ctx-git/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/MauricioPerera/ctx-git/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MauricioPerera/ctx-git/releases/tag/v0.1.0
