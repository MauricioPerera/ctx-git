# ctx-git architecture

Technical reference for how ctx-git is built internally.

## Module overview

```
src/
├── pkt-line.mjs       — Git's packet framing format (encode + decode)
├── protocol-v2.mjs    — Smart HTTP protocol v2: capabilities + ls-refs
├── fetch.mjs          — Protocol v2 fetch command + sideband parsing
├── packfile.mjs       — Packfile binary parser (inflate + variable-length headers)
├── objects.mjs        — Git object parsers (commit, tree, blob)
├── encode.mjs         — Git object encoder + packfile encoder
├── push.mjs           — Protocol v1 git-receive-pack
└── index.mjs          — High-level CtxGitRepo API
```

~1,500 lines total.

## Design choices

### Why no dependencies?

- Bundle stays ~30 KiB (easier to deploy on edge)
- No supply-chain risk
- Understand every byte on the wire
- Ensures the library works in any runtime that supports Web standards

### Why not isomorphic-git?

`isomorphic-git` is excellent for full git workflows (clone, merge, branch, checkout, log, blame, etc). But:

- 20K+ lines, 10x larger
- Doesn't yet support `--filter=blob:none` natively (open issue)
- Covers features we'll never use (stash, rebase, etc.)
- More surface area = more to debug in Workers runtime

ctx-git is the **minimal surface** needed for agent-memory use cases.

## Layer 1: pkt-line

**File**: `src/pkt-line.mjs`

Git's wire format uses "pkt-lines" — length-prefixed packets:

```
<4 hex chars for length (including these 4)><data>
```

Special cases:
- `0000` = flush-pkt (end of section)
- `0001` = delim-pkt (protocol v2 section separator)
- `0002` = response-end-pkt

```javascript
import { encode, parseStream, FLUSH_PKT } from "./pkt-line.mjs";

const pkts = [
  encode("command=fetch\n"),
  encode("agent=ctx-git/0.1\n"),
  FLUSH_PKT,
];

// Wire format:
// "0018command=fetch\n" + "001aagent=ctx-git/0.1\n" + "0000"
```

## Layer 2: Protocol v2 (discovery + ls-refs)

**File**: `src/protocol-v2.mjs`

### Capability discovery

```
GET /info/refs?service=git-upload-pack
Header: Git-Protocol: version=2
```

Server responds with its supported capabilities:

```
version 2
agent=git/github-...
ls-refs=unborn
fetch=shallow wait-for-done filter
object-format=sha1
0000
```

We parse this into a `Map<capability, Array<value>>`.

### ls-refs

Lists remote refs (branches, tags):

```
POST /git-upload-pack
Body:
  command=ls-refs
  agent=ctx-git/0.1
  0001                    (delim)
  peel
  symrefs
  ref-prefix refs/heads/
  0000                    (flush)
```

Response is a series of pkt-lines:

```
<oid> HEAD symref-target:refs/heads/main
<oid> refs/heads/main
<oid> refs/heads/feature-x
0000
```

## Layer 3: Fetch with filter

**File**: `src/fetch.mjs`

Requests specific commits (and optionally their trees/blobs) from the remote.

### Request body

```
command=fetch
agent=ctx-git/0.1
object-format=sha1
0001
want <oid>
have <oid>          (optional, for incremental fetches)
filter blob:none    (optional, for blobless clone)
deepen 1            (shallow)
ofs-delta
done
0000
```

### Response structure (v2)

```
acknowledgments
  ACK <oid> or NAK
0001
shallow-info
  shallow <oid>
0001
packfile
  <sideband 0x01 + pack data chunk>
  <sideband 0x02 + progress message>
  <sideband 0x03 + error>
0000
```

The packfile data is **sideband-multiplexed**: each pkt-line's first byte is the band number.

## Layer 4: Packfile parsing

**File**: `src/packfile.mjs`

### Packfile format

```
[ 12 bytes header ]
  "PACK"   (4 bytes magic)
  0x00000002 (4 bytes version, big-endian)
  0xNNNNNNNN (4 bytes object count)

[ N objects ]
  <variable-length type + size header>
  <zlib-compressed data>

[ 20 bytes SHA-1 of everything above ]
```

### Object header encoding

First byte:
```
MSB | type(3) | size_low(4)
```

If MSB is set, more bytes follow, each contributing 7 more bits of size (little-endian):
```
MSB | size_bits(7)
```

### Object types

| Code | Type |
|---|---|
| 1 | commit |
| 2 | tree |
| 3 | blob |
| 4 | tag |
| 6 | ofs-delta |
| 7 | ref-delta |

ctx-git **does not yet resolve delta objects** (types 6 and 7). This limits us to:
- Small repos (GitHub often sends deltas for repos >~100MB)
- Non-delta-compressed packs (fresh clones of small repos)

### Finding compressed stream boundaries

zlib streams don't tell you their length in advance. We use a binary-search over input length: try decompressing slices until we find the smallest one that yields the expected output.

This is O(log N) decompressions per object. Fine for small objects, can get slow for very large repos.

## Layer 5: Object parsers

**File**: `src/objects.mjs`

### Commit

Text format:

```
tree <oid>
parent <oid>
parent <oid>            (multiple parents = merge)
author <name> <email> <unix-timestamp> <tz>
committer <name> <email> <unix-timestamp> <tz>
<blank line>
<message>
```

### Tree

Binary format. Sequence of entries:

```
<mode ASCII (e.g. "100644" or "40000")>
<space>
<name>
<NUL>
<20 bytes SHA-1 binary>
```

Entries sorted by name (with trees treated as if they had a trailing `/`).

### Blob

Raw bytes. The content of the file.

## Layer 6: Object + pack encoding (for writes)

**File**: `src/encode.mjs`

### Computing a git OID

```
SHA-1("<type> <size>\0<content>")
```

via Web Crypto API:

```javascript
const header = new TextEncoder().encode(`${type} ${content.length}\0`);
const combined = new Uint8Array(header.length + content.length);
combined.set(header, 0);
combined.set(content, header.length);
const hash = await crypto.subtle.digest("SHA-1", combined);
```

### Creating a tree

Serialize entries sorted, then compute OID:

```javascript
const entries = [
  { mode: "100644", name: "README.md", oid: "abc..." },
  { mode: "40000", name: "src", oid: "def..." },
];
const treeContent = encodeTree(entries);
const treeOid = await computeOid("tree", treeContent);
```

### Creating a commit

```javascript
const commitContent = encodeCommit({
  tree: newTreeOid,
  parents: [currentHeadOid],
  author: formatPerson("bot", "bot@example.com"),
  committer: formatPerson("bot", "bot@example.com"),
  message: "add new file",
});
const commitOid = await computeOid("commit", commitContent);
```

### Building a packfile for push

```javascript
const pack = await encodePackfile([
  { type: "blob", content: blobBytes },
  { type: "tree", content: treeBytes },
  { type: "commit", content: commitBytes },
]);
// Structure: header (12 bytes) + objects + SHA-1 (20 bytes)
```

## Layer 7: git-receive-pack (push)

**File**: `src/push.mjs`

Protocol v1 only (v2 push is not supported by git).

### Request body

```
<old-oid> <new-oid> <ref-name>\0<capabilities>\n
0000
<raw packfile bytes>
```

Example:

```
0000000000000000000000000000000000000000 abc123... refs/heads/main\0report-status
0000
<pack bytes>
```

`old-oid` is `000...0` when creating a new ref.

### Response

With `report-status` capability:

```
unpack ok
ok refs/heads/main
0000
```

Or on failure:

```
unpack ok
ng refs/heads/main non-fast-forward
0000
```

When non-fast-forward is detected, `ctx-git` fetches fresh HEAD and retries.

## Layer 8: High-level API (CtxGitRepo)

**File**: `src/index.mjs`

### State

A `CtxGitRepo` instance maintains:

```javascript
{
  url: string,
  token: string,
  branch: string,
  objects: Map<oid, { type, data }>,  // local object cache
  headOid: string,                     // current ref value
  headTreeOid: string,                 // current root tree
  refs: Array<{ refName, oid }>,       // discovered refs
}
```

The `objects` Map is append-only within a session. Gets populated as you fetch.

### Read flow (`readFile`)

```
1. init() → resolve HEAD oid
2. hydrateStructure() → fetch commits + trees (no blobs)
3. walk tree to find blob oid for the requested path
4. readBlob(oid):
     - if in cache → return
     - else fetch(want=<oid>, filter=blob:none) → parse pack → cache → return
5. decode UTF-8
```

### Write flow (`writeFiles`)

```
1. hydrateStructure() if not done
2. For each operation:
     - if create/update: compute blob OID, create blob object
     - recursively update trees from leaf to root, creating new tree objects
3. Create commit object pointing to new root tree, parent = current HEAD
4. Encode all new objects into a packfile
5. git-receive-pack (old=HEAD, new=newCommit, ref=main, pack=packfile)
6. If non-fast-forward: re-init, go back to step 1 (up to maxRetries)
7. On success: update headOid locally
```

### Memory map (`readMap`)

```
1. hydrateStructure() if not done
2. Navigate to rootPath (fetch subtrees if not cached)
3. Recursively:
     a. Find memory.md entry in tree
     b. If found, readBlob + decode as description
     c. Collect non-memory.md files
     d. Recurse into subfolders (up to maxDepth)
4. Return tree structure
```

## Worker-specific considerations

### `nodejs_compat` flag

Required in `wrangler.jsonc`:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"]
}
```

This gives us `node:zlib` in the Worker runtime.

### Why `node:zlib` instead of DecompressionStream?

DecompressionStream works, but in Node 22+ it throws `ERR_TRAILING_JUNK_AFTER_STREAM_END` when there's data after the zlib stream (which is always the case in packfiles — next object follows the previous one).

Working around this requires catching the error and checking if enough output was produced. Possible, but hacky. `node:zlib` is more permissive.

Future: implement a `pureWeb` build using `DecompressionStream` with proper error handling for non-Node environments that don't have `nodejs_compat`.

### Bundle size

```
Total: ~30 KiB uncompressed
       ~7.8 KiB gzipped
```

Most of this is the binary packfile parsing + protocol handshake code. Very small compared to typical agent frameworks.

### Cold start

Worker startup time: ~13ms. The library itself adds no appreciable startup overhead.

## Testing approach

Currently smoke tests only (`test-*.mjs` at repo root). TODO: proper test suite with:

- Unit tests for each layer (pkt-line, protocol-v2, fetch, packfile, objects, encode, push)
- Integration tests against a local git server (to avoid hitting GitHub rate limits during CI)
- Conformance tests with multiple git server implementations (GitHub, GitLab, Gitea)

## Known limitations

### Delta resolution

ctx-git doesn't yet handle `ofs-delta` (type 6) or `ref-delta` (type 7) objects in packfiles. These are objects stored as diffs against another object, used for compression.

In practice:
- Most small/medium repos don't use deltas much (packs are sent fresh)
- GitHub may send deltas for large repos or long history chains
- Fix requires implementing the copy/insert instruction stream (~100 lines)

### Large files

Each blob is loaded into memory as a Uint8Array. For files > ~10MB this gets expensive in Workers (128MB memory limit).

Fix: stream API for large blobs.

### Concurrent writes

The `maxRetries` mechanism handles concurrent writes by retrying the whole operation with fresh HEAD. This is O(n²) in the worst case if many writers contend for the same branch.

For high-concurrency use cases: use multiple branches, or layer a queue on top.

## Extension points

If you want to extend ctx-git, clean places to hook in:

1. **Custom hash backends** — replace `crypto.subtle.digest` calls in `encode.mjs` + `index.mjs`
2. **Custom compression** — replace `zlib` calls in `packfile.mjs` + `encode.mjs`
3. **Custom object stores** — the `objects` Map could be backed by R2/D1/KV for persistence across Worker invocations
4. **Custom retrieval** — subclass `CtxGitRepo` and add methods that combine reads (e.g., `findByTopic()`, `fullTextSearch()`)
