# The memory.md hierarchy pattern

A self-describing, LLM-navigable directory structure for storing agent context in git repositories.

## TL;DR

Put a `memory.md` file in every folder of the repo. It describes:
- What's in that folder
- Subfolders and their purpose
- Notable files
- Conventions for adding new content

An AI agent reads the `memory.md` along the path it needs (not the whole tree), decides where to go next, and eventually lands on a specific file. This gives you **self-describing memory** with no embeddings, no vector DB, no external index.

## Why this pattern

### Alternatives and their limits

| Approach | Scales to | Needs extra infra | Self-describing | Git-native |
|---|---|---|---|---|
| Hardcoded paths | ~20 files | ❌ | ❌ | ✅ |
| Single root `INDEX.md` | ~100 files | ❌ | ✅ | ✅ |
| Embeddings + vector search | 1M+ files | ✅ (vector DB) | ⚠️ | ❌ |
| **memory.md hierarchy** | **10K+ files** | **❌** | **✅** | **✅** |

### What makes it good

1. **Self-documenting**: the repo explains itself on any file browser (GitHub, VS Code, CLI `tree`).
2. **Lazy loading**: the agent reads only the `memory.md` files on the path it needs, not the whole repo.
3. **No stale index problem**: each `memory.md` lives next to what it describes, so authors update both atomically.
4. **Scales to any depth**: nested folders have their own indexes.
5. **Zero dependencies**: no embedder, no index process, no cache invalidation.
6. **LLM-friendly**: structured markdown is easy for LLMs to parse.

## The memory.md format

There is no enforced schema. The convention is markdown with sections. A recommended template:

```markdown
# /<folder-name> — <short purpose>

One-line description of what this folder is for.

## Structure

<brief description of organization — subfolders by date? by topic?>

## Subfolders

- `folder-a/` — purpose of folder-a
- `folder-b/` — purpose of folder-b

## Files

- `file1.md` — summary of file1
- `file2.md` — summary of file2

## Conventions

<how should new content be added here?>
<what metadata should each file include?>
```

### Minimal viable memory.md

If you don't want to write all the sections, the minimum useful is:

```markdown
# <folder>

<one-line purpose>

## Index

- file1.md — summary
- subfolder/ — purpose
```

An agent can navigate based on this alone.

### Root memory.md

The root `memory.md` should give the agent a mental map of the whole repo:

```markdown
# Agent Memory — <user or project name>

Root index.

## Structure

- `/profile/` — stable identity facts (name, role, tech stack)
- `/decisions/` — chronological decision log
- `/preferences/` — learned patterns about user behavior
- `/context/` — active project state

## Navigation tip

Each folder has a memory.md. Read it before reading specific files.

## How to add new memory

- New decision → `/decisions/YYYY-MM-DD/<topic>.md` + update parent memory.md
- New preference → `/preferences/<category>.md`
- New project context → `/context/<project-name>.md`
```

## Reading with ctx-git

### Full map

```javascript
import { CtxGitRepo } from "ctx-git";

const repo = new CtxGitRepo(url, { token });
const map = await repo.readMap({ maxDepth: 3 });

// Format for LLM prompt
const formatted = CtxGitRepo.formatMap(map);
```

### Lazy navigation (preferred)

Read one level at a time:

```javascript
// Step 1: just the root memory.md + immediate subfolders
const rootMap = await repo.readMap({ maxDepth: 1 });

// LLM decides which subfolder is relevant based on rootMap

// Step 2: recurse into chosen subfolder
const subMap = await repo.readMap({
  rootPath: "decisions",
  maxDepth: 1,
});

// LLM decides a specific file

// Step 3: read the final file
const content = await repo.readFile("decisions/2026-04-16/product-direction.md");
```

### Structure of a map node

`readMap()` returns:

```typescript
{
  path: string;                 // e.g. "decisions/2026-04-16"
  description: string | null;   // contents of memory.md at this level
  indexOid: string | null;      // git OID of memory.md
  files: Array<{                // non-index files at this level
    name: string;
    path: string;
    oid: string;
  }>;
  subfolders: Array<MapNode>;   // recursive
  truncated?: boolean;          // true if maxDepth cutoff
}
```

## Writing with the pattern

When your agent adds a new memory, it should also update the parent's `memory.md` **in the same commit**. ctx-git makes this atomic:

```javascript
await repo.writeFiles(
  [
    {
      path: "decisions/2026-04-17/naming.md",
      content: `# Decision: Naming

## Context
...

## Decision
Named it "ctx-git".
`,
    },
    {
      path: "decisions/2026-04-17/memory.md",
      content: `# /decisions/2026-04-17

Decisions made on this date.

## Files

- naming.md — chose "ctx-git" as the library name
`,
    },
    {
      path: "decisions/memory.md",
      content: /* updated to include 2026-04-17 in recent list */,
    },
  ],
  {
    message: "decide naming: ctx-git",
    author: { name: "agent", email: "agent@example.com" },
  },
);
```

All three files (or however many) end up in one commit. If the push fails (non-fast-forward), `ctx-git` retries with fresh HEAD automatically.

## The full agent flow

```
┌─────────────────────────────────────────────────────────┐
│  User asks: "what did we decide about product?"         │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Agent.readMap({ maxDepth: 1 })                         │
│  → { path: "/", description: "...", subfolders: [...] } │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  LLM decides: "decisions" folder is relevant            │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Agent.readMap({ rootPath: "decisions", maxDepth: 1 })  │
│  → { subfolders: [2026-04-16, 2026-04-17], files: [] }  │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  LLM decides: "2026-04-16" subfolder                    │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Agent.readMap({                                        │
│    rootPath: "decisions/2026-04-16",                    │
│    maxDepth: 1                                          │
│  })                                                     │
│  → { files: [product-direction.md, structure-over...]} │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  LLM decides: "product-direction.md"                    │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Agent.readFile("decisions/2026-04-16/product-direc...")│
│  → actual file content                                  │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  LLM answers based on the content                       │
└─────────────────────────────────────────────────────────┘
```

**Total: 4 reads** (3 `memory.md` + 1 content file). Never loaded the whole repo.

## Advanced: combining with smarter layers

The `memory.md` hierarchy is **Layer 1**. As the repo grows, you can stack:

- **Layer 2** — Knowledge graph: add explicit links between files (`SAME_TOPIC`, `REFERS_TO`, `PARENT_OF`) for multi-hop retrieval. See [hereltical-rag](https://github.com/MauricioPerera/hereltical-rag).
- **Layer 3** — Budget cascade: static lookup → learned cache → semantic search → rerank → AI fallback. See [learning-rag](https://github.com/MauricioPerera/learning-rag).
- **Layer 4** — Pattern learning: detect which files the user tends to need for which types of questions. See [Skill-Bank](https://github.com/MauricioPerera/Skill-Bank).

Each layer is additive: `memory.md` works standalone; add layers when scale demands.

## FAQ

### What if a folder doesn't have a memory.md?

`readMap` still works — the node just has `description: null`. The agent can still see the files and subfolders and decide based on names alone.

### What if my memory.md files become stale?

Same problem as any documentation. Mitigations:

- Update in the same commit as content changes (atomic)
- Periodic lint: walk the tree, flag folders where files changed but memory.md didn't
- LLM-assisted update: after writing a new file, ask the LLM to regenerate the affected memory.md

### Can I use a different filename?

Yes:

```javascript
await repo.readMap({ indexFile: "INDEX.md" });
// or "README.md", ".memory.md", whatever.
```

### Does it work with private repos?

Yes. Pass `token` in `CtxGitRepo` options. Works with any git server that supports protocol v2 + HTTP Basic auth (GitHub, GitLab, Gitea, Bitbucket, self-hosted).

### Does it work with GitHub Enterprise?

Yes, as long as the enterprise instance supports protocol v2 (introduced in git 2.18, commonly available since GHE 2.19).
