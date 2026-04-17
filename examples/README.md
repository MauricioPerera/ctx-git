# Examples

Runnable examples demonstrating ctx-git features. All examples use the public demo repo `MauricioPerera/memory-poc` by default; set `REPO_URL` env to point elsewhere.

## Prerequisites

You need a GitHub token with `repo` scope (for private repos) or just read access (for public). The examples use `gh auth token`:

```bash
export GH_TOKEN=$(gh auth token)
```

Or set a `REPO_URL` env to use a different repo:

```bash
export REPO_URL="https://github.com/yourname/your-repo"
```

## Examples

### 01 - Read a single file

Read one file from a repo without cloning the whole thing.

```bash
node examples/01-read-file.mjs
```

### 02 - Write a file

Create/update a file with a commit + push, all from the library.

```bash
node examples/02-write-file.mjs
```

### 03 - Multi-file atomic commit

Create multiple files + delete one in a single atomic commit.

```bash
node examples/03-multi-file-commit.mjs
```

### 04 - Navigate memory with memory.md hierarchy

Walk the repo's `memory.md` files to build a navigable map.

```bash
node examples/04-navigate-memory.mjs
```

### 05 - Branches

Create a branch, write to it, clean it up. Useful for "what-if" forks.

```bash
node examples/05-branches.mjs
```

## What the demo repo looks like

The default `memory-poc` repo has this structure:

```
/memory.md                                   (root index)
/profile/
  memory.md                                  (describes profile/)
  personal.md
  work.md
/decisions/
  memory.md                                  (describes decisions/)
  2026-04-16/
    memory.md
    product-direction.md
    structure-over-similarity.md
  2026-04-17/
    memory.md
    memory-md-hierarchy.md
/preferences/
  memory.md
  decision-making.md
  communication-style.md
/context/
  memory.md
  ctx-git.md
```

You can browse it at https://github.com/MauricioPerera/memory-poc.

## Running all examples

```bash
for ex in examples/*.mjs; do
  echo "=== $ex ==="
  node "$ex"
  echo ""
done
```

## Troubleshooting

- **`No GH_TOKEN`**: set `GH_TOKEN` env or sign in via `gh auth login`.
- **`404 Not Found`**: the repo doesn't exist or your token doesn't have access.
- **`Size mismatch` errors**: large repos using delta compression. ctx-git doesn't yet resolve deltas; try a smaller repo.
