// ctx-git: High-level API — Worker-compatible (Web Crypto).
// Works in: Cloudflare Workers, Node 18+, modern browsers, Deno.

import { discoverCapabilities, lsRefs } from "./protocol-v2.mjs";
import { fetchObjects } from "./fetch.mjs";
import { parsePackfile } from "./packfile.mjs";
import { parseCommit, parseTree, blobToString } from "./objects.mjs";
import {
  computeOid,
  encodeTree,
  encodeCommit,
  encodePackfile,
  formatPerson,
} from "./encode.mjs";
import { gitReceivePack } from "./push.mjs";

const te = new TextEncoder();
export const ZERO_OID = "0000000000000000000000000000000000000000";
const DEFAULT_BRANCH = "main";

/**
 * Compute the git SHA-1 OID of an object.
 * Uses Web Crypto API — works in all modern runtimes.
 */
export async function gitOid(type, data) {
  return computeOid(type, data);
}

/**
 * A ctx-git repository handle with read/write access.
 * Maintains an in-memory object store that accumulates fetched objects
 * (lazy hydration pattern).
 */
export class CtxGitRepo {
  constructor(url, options = {}) {
    this.url = url;
    this.token = options.token;
    this.branch = options.branch || DEFAULT_BRANCH;
    /** @type {Map<string, { type: string, data: Uint8Array }>} */
    this.objects = new Map();
    this.headOid = null;
    this.headTreeOid = null;
  }

  // ====================================================================
  // Initialization
  // ====================================================================

  /**
   * Discover server capabilities and resolve the branch head.
   */
  async init() {
    const caps = await discoverCapabilities(this.url, { token: this.token });
    if (!caps.capabilities.has("fetch")) {
      throw new Error("Server does not support fetch command");
    }
    const fetchCap = caps.capabilities.get("fetch") || [];
    if (!fetchCap.includes("filter")) {
      throw new Error("Server does not support filter (blobless clone impossible)");
    }

    const refs = await lsRefs(this.url, { token: this.token });
    const branchRef = `refs/heads/${this.branch}`;
    const head = refs.find((r) => r.refName === branchRef) ||
                 refs.find((r) => r.refName === "HEAD");
    if (!head) throw new Error(`Branch not found: ${this.branch}`);
    this.headOid = head.oid;
    this.refs = refs;
    return { headOid: head.oid, caps: Object.fromEntries(caps.capabilities), refs };
  }

  /**
   * List all branches available on the remote.
   */
  async listBranches() {
    if (!this.refs) await this.init();
    return this.refs
      .filter((r) => r.refName.startsWith("refs/heads/"))
      .map((r) => ({
        name: r.refName.slice("refs/heads/".length),
        oid: r.oid,
      }));
  }

  // ====================================================================
  // Read path
  // ====================================================================

  /**
   * Fetch commits + trees (no blobs) from the current branch head.
   */
  async hydrateStructure() {
    if (!this.headOid) await this.init();

    const result = await fetchObjects(this.url, {
      wants: [this.headOid],
      filter: "blob:none",
      depth: 1,
      token: this.token,
    });

    const pack = await parsePackfile(result.packData);
    for (const obj of pack.objects) {
      const oid = await computeOid(obj.typeName, obj.data);
      this.objects.set(oid, { type: obj.typeName, data: obj.data });
    }

    const commitObj = this.objects.get(this.headOid);
    if (!commitObj) throw new Error("Commit not in pack");
    const commit = parseCommit(commitObj.data);
    this.headTreeOid = commit.tree;

    return { numObjects: pack.numObjects, packBytes: result.packData.length };
  }

  /**
   * List all files (blobs) recursively from the current HEAD tree.
   */
  listFiles(treeOid = null, prefix = "") {
    const oid = treeOid || this.headTreeOid;
    if (!oid) throw new Error("Structure not hydrated; call hydrateStructure() first");
    const treeObj = this.objects.get(oid);
    if (!treeObj) throw new Error(`Tree ${oid} not in store`);
    const entries = parseTree(treeObj.data);
    const results = [];
    for (const entry of entries) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === "tree") {
        results.push(...this.listFiles(entry.oid, fullPath));
      } else if (entry.type === "blob") {
        results.push({ path: fullPath, oid: entry.oid, mode: entry.mode });
      }
    }
    return results;
  }

  findBlobOid(path) {
    const files = this.listFiles();
    const match = files.find((f) => f.path === path);
    return match ? match.oid : null;
  }

  /**
   * Read a blob by OID. Fetches on-demand if not in store.
   */
  async readBlob(oid) {
    let obj = this.objects.get(oid);
    if (!obj) {
      const result = await fetchObjects(this.url, {
        wants: [oid],
        filter: "blob:none",
        token: this.token,
      });
      const pack = await parsePackfile(result.packData);
      for (const o of pack.objects) {
        const computedOidValue = await computeOid(o.typeName, o.data);
        this.objects.set(computedOidValue, { type: o.typeName, data: o.data });
      }
      obj = this.objects.get(oid);
      if (!obj) throw new Error(`Blob ${oid} not returned by server`);
    }
    return obj.data;
  }

  /**
   * Read a file by path.
   */
  async readFile(path) {
    if (!this.headTreeOid) await this.hydrateStructure();
    const oid = this.findBlobOid(path);
    if (!oid) throw new Error(`File not found: ${path}`);
    const data = await this.readBlob(oid);
    return blobToString(data);
  }

  // ====================================================================
  // Memory map (hierarchical memory.md navigation)
  // ====================================================================

  /**
   * Build a hierarchical map of the repo using `memory.md` (or custom) files
   * at each level. Perfect for AI agents that need to navigate context
   * progressively without loading the whole repo.
   *
   * Each folder can contain a `memory.md` file describing:
   *   - what lives in that folder
   *   - subfolders and their purpose
   *   - files and their summaries
   *   - conventions for adding new content
   *
   * Usage pattern for an agent:
   *   1. readMap({ maxDepth: 1 }) → get root memory.md + list of subfolders
   *   2. agent/LLM picks relevant subfolder
   *   3. readMap({ rootPath: "decisions", maxDepth: 1 }) → dive deeper
   *   4. Repeat until leaf, then readFile() specific files
   *
   * @param {object} [options]
   * @param {string} [options.indexFile="memory.md"] — filename to read at each level
   * @param {string} [options.rootPath=""] — start from this path
   * @param {number} [options.maxDepth=3] — how many levels to recurse
   * @param {boolean} [options.includeFileList=true] — list non-index files at each level
   */
  async readMap(options = {}) {
    const indexFile = options.indexFile || "memory.md";
    const rootPath = options.rootPath || "";
    const maxDepth = options.maxDepth ?? 3;
    const includeFileList = options.includeFileList ?? true;

    if (!this.headTreeOid) await this.hydrateStructure();

    // Resolve the starting tree OID
    let startTreeOid = this.headTreeOid;
    if (rootPath) {
      const parts = rootPath.split("/").filter(Boolean);
      for (const part of parts) {
        const entries = this._treeEntries(startTreeOid);
        if (entries === null) {
          await this._fetchTree(startTreeOid);
        }
        const resolved = this._treeEntries(startTreeOid) || [];
        const next = resolved.find((e) => e.name === part && e.type === "tree");
        if (!next) throw new Error(`Path not found: ${rootPath}`);
        startTreeOid = next.oid;
      }
    }

    return this._buildMap(
      startTreeOid,
      rootPath,
      indexFile,
      maxDepth,
      0,
      includeFileList,
    );
  }

  async _buildMap(treeOid, prefix, indexFile, maxDepth, depth, includeFileList) {
    const entries = this._treeEntries(treeOid);
    if (entries === null) {
      await this._fetchTree(treeOid);
    }
    const resolved = this._treeEntries(treeOid) || [];

    const node = {
      path: prefix || "/",
      description: null,
      files: [],
      subfolders: [],
    };

    // Look for the index file at this level
    const indexEntry = resolved.find(
      (e) => e.type === "blob" && e.name === indexFile,
    );
    if (indexEntry) {
      const blob = await this.readBlob(indexEntry.oid);
      node.description = new TextDecoder().decode(blob);
      node.indexOid = indexEntry.oid;
    }

    // Collect files and subfolders
    for (const entry of resolved) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === "blob") {
        if (entry.name === indexFile) continue; // already captured
        if (includeFileList) {
          node.files.push({ name: entry.name, path: fullPath, oid: entry.oid });
        }
      } else if (entry.type === "tree") {
        if (depth < maxDepth) {
          const child = await this._buildMap(
            entry.oid,
            fullPath,
            indexFile,
            maxDepth,
            depth + 1,
            includeFileList,
          );
          node.subfolders.push(child);
        } else {
          // Hit max depth: note the subfolder exists but don't recurse
          node.subfolders.push({
            path: fullPath,
            description: null,
            files: [],
            subfolders: [],
            truncated: true,
          });
        }
      }
    }

    return node;
  }

  /**
   * Format a map tree as a markdown string, suitable for feeding to an LLM.
   *
   * Example output:
   *   /
   *   Root memory: agent context for user X
   *
   *   ├─ profile/
   *   │  Personal info, technical prefs
   *   │  - personal.md
   *   │  - work.md
   *   ├─ decisions/
   *   │  Log of key decisions by date
   *   │  ...
   */
  static formatMap(node, indent = "") {
    let out = "";
    const label = node.path === "" ? "/" : node.path;
    out += `${indent}${label}\n`;
    if (node.description) {
      const firstLine = node.description
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .slice(0, 2)
        .join(" ")
        .slice(0, 200);
      if (firstLine) out += `${indent}  ▸ ${firstLine}\n`;
    }
    for (const file of node.files) {
      out += `${indent}  - ${file.name}\n`;
    }
    for (const sub of node.subfolders) {
      if (sub.truncated) {
        out += `${indent}  └─ ${sub.path}/ (not expanded)\n`;
      } else {
        out += CtxGitRepo.formatMap(sub, indent + "  ");
      }
    }
    return out;
  }

  // ====================================================================
  // Write path
  // ====================================================================

  /**
   * Write a single file and push in one shot.
   * Convenience wrapper around `writeFiles`.
   */
  async writeFile(path, content, commitInfo, options = {}) {
    return this.writeFiles([{ path, content }], commitInfo, options);
  }

  /**
   * Delete a single file and push in one shot.
   */
  async deleteFile(path, commitInfo, options = {}) {
    return this.writeFiles([{ path, delete: true }], commitInfo, options);
  }

  /**
   * Write/delete multiple files in a single commit.
   *
   * @param {Array<{ path: string, content?: string, delete?: boolean }>} operations
   * @param {{ message: string, author: { name: string, email: string } }} commitInfo
   * @param {{ maxRetries?: number }} options — retry on non-fast-forward (default 3)
   */
  async writeFiles(operations, commitInfo, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Fresh state each attempt (re-read HEAD in case concurrent writes happened)
      if (attempt > 0) {
        this.headOid = null;
        this.headTreeOid = null;
        this.refs = null;
      }
      if (!this.headTreeOid) await this.hydrateStructure();

      const oldOid = this.headOid;

      let prepared;
      try {
        prepared = await this._prepareCommit(operations, commitInfo);
      } catch (e) {
        // Hard error — don't retry
        throw e;
      }

      const { newCommitOid, newRootTreeOid, newObjects } = prepared;
      const packfile = await encodePackfile(
        newObjects.map((o) => ({ type: o.type, content: o.content })),
      );

      let result;
      try {
        result = await gitReceivePack(this.url, {
          oldOid,
          newOid: newCommitOid,
          ref: `refs/heads/${this.branch}`,
          packfile,
          token: this.token,
        });
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) continue;
        throw e;
      }

      if (result.ok) {
        // Update local state to reflect the new commit so subsequent read/write
        // operations use the new tree (fix for stale headTreeOid bug).
        this.headOid = newCommitOid;
        this.headTreeOid = newRootTreeOid;
        return {
          ok: true,
          commitOid: newCommitOid,
          unpack: result.unpack,
          refs: result.refs,
          newObjects: newObjects.map((o) => ({ type: o.type, oid: o.oid })),
          packfileBytes: packfile.length,
          attempts: attempt + 1,
        };
      }

      // Not OK — check if it's a retry-able error (non-fast-forward)
      const refResult = result.refs.find((r) => r.ref === `refs/heads/${this.branch}`);
      const isNonFastForward =
        refResult &&
        (refResult.reason?.includes("non-fast-forward") ||
          refResult.reason?.includes("fetch first") ||
          refResult.reason?.includes("stale"));

      lastError = { ok: false, result };

      if (isNonFastForward && attempt < maxRetries) {
        continue; // retry with fresh HEAD
      }

      // Other failure — don't retry
      return {
        ok: false,
        unpack: result.unpack,
        refs: result.refs,
        attempts: attempt + 1,
      };
    }

    if (lastError instanceof Error) throw lastError;
    return { ok: false, ...(lastError || {}), attempts: maxRetries + 1 };
  }

  // ====================================================================
  // Write path internals
  // ====================================================================

  _treeEntries(treeOid) {
    if (!treeOid) return [];
    const obj = this.objects.get(treeOid);
    if (!obj) return null; // caller should fetch
    return parseTree(obj.data);
  }

  async _prepareCommit(operations, commitInfo) {
    const newObjects = [];

    // Group operations by parent directory for batch tree updates
    // Simpler approach: apply each operation sequentially, updating the tree.
    let currentRootOid = this.headTreeOid;

    for (const op of operations) {
      const parts = op.path.split("/").filter(Boolean);
      if (parts.length === 0) throw new Error(`Invalid path: ${op.path}`);

      if (op.delete) {
        currentRootOid = await this._updateTreePath(
          currentRootOid,
          parts,
          null, // null oid = delete
          null,
          newObjects,
          { delete: true },
        );
      } else {
        const blobContent = te.encode(op.content);
        const blobOid = await computeOid("blob", blobContent);
        if (!this.objects.has(blobOid)) {
          newObjects.push({ type: "blob", oid: blobOid, content: blobContent });
          this.objects.set(blobOid, { type: "blob", data: blobContent });
        }

        currentRootOid = await this._updateTreePath(
          currentRootOid,
          parts,
          blobOid,
          "100644",
          newObjects,
        );
      }
    }

    // Edge case: all operations were deletes and emptied the root tree.
    // Git allows empty trees; create one explicitly (empty trees have a
    // well-known OID: 4b825dc642cb6eb9a060e54bf8d69288fbee4904).
    if (currentRootOid === null) {
      const emptyTreeContent = new Uint8Array(0);
      const emptyTreeOid = await computeOid("tree", emptyTreeContent);
      if (!this.objects.has(emptyTreeOid)) {
        newObjects.push({
          type: "tree",
          oid: emptyTreeOid,
          content: emptyTreeContent,
        });
        this.objects.set(emptyTreeOid, { type: "tree", data: emptyTreeContent });
      }
      currentRootOid = emptyTreeOid;
    }

    // Create the commit
    const now = Math.floor(Date.now() / 1000);
    const author = formatPerson(
      commitInfo.author.name,
      commitInfo.author.email,
      now,
      "+0000",
    );
    const committer = author;

    const commitContent = encodeCommit({
      tree: currentRootOid,
      parents: this.headOid ? [this.headOid] : [],
      author,
      committer,
      message: commitInfo.message,
    });
    const commitOid = await computeOid("commit", commitContent);
    newObjects.push({ type: "commit", oid: commitOid, content: commitContent });
    this.objects.set(commitOid, { type: "commit", data: commitContent });

    return { newCommitOid: commitOid, newRootTreeOid: currentRootOid, newObjects };
  }

  /**
   * Recursively walk down `parts` from the given tree, creating/updating/deleting
   * entries along the way.
   */
  async _updateTreePath(
    currentTreeOid,
    parts,
    targetOid,
    targetMode,
    newObjects,
    opts = {},
  ) {
    const entries = this._treeEntries(currentTreeOid);
    if (entries === null && currentTreeOid) {
      await this._fetchTree(currentTreeOid);
    }
    const resolvedEntries = this._treeEntries(currentTreeOid) || [];

    const [head, ...rest] = parts;

    let updatedEntry = null;

    if (rest.length === 0) {
      if (opts.delete) {
        // Remove the entry; updatedEntry stays null
      } else {
        updatedEntry = { mode: targetMode, name: head, oid: targetOid };
      }
    } else {
      const existing = resolvedEntries.find((e) => e.name === head);
      const subtreeOid = existing && existing.type === "tree" ? existing.oid : null;

      if (subtreeOid && !this.objects.has(subtreeOid)) {
        await this._fetchTree(subtreeOid);
      }

      const newSubtreeOid = await this._updateTreePath(
        subtreeOid || null,
        rest,
        targetOid,
        targetMode,
        newObjects,
        opts,
      );

      // If the child tree is now empty (all deletes), also remove this subtree entry
      if (newSubtreeOid === null) {
        // updatedEntry stays null → entry removed
      } else {
        updatedEntry = { mode: "40000", name: head, oid: newSubtreeOid };
      }
    }

    // Build the new tree entries
    const newEntries = resolvedEntries.filter((e) => e.name !== head);
    if (updatedEntry) newEntries.push(updatedEntry);

    // If empty, return null to signal "remove from parent"
    if (newEntries.length === 0) {
      return null;
    }

    const treeContent = encodeTree(
      newEntries.map((e) => ({ mode: e.mode, name: e.name, oid: e.oid })),
    );
    const treeOid = await computeOid("tree", treeContent);
    if (!this.objects.has(treeOid)) {
      newObjects.push({ type: "tree", oid: treeOid, content: treeContent });
      this.objects.set(treeOid, { type: "tree", data: treeContent });
    }

    return treeOid;
  }

  async _fetchTree(treeOid) {
    const result = await fetchObjects(this.url, {
      wants: [treeOid],
      filter: "blob:none",
      token: this.token,
    });
    const pack = await parsePackfile(result.packData);
    for (const o of pack.objects) {
      const oid = await computeOid(o.typeName, o.data);
      this.objects.set(oid, { type: o.typeName, data: o.data });
    }
  }

  // ====================================================================
  // Branch operations
  // ====================================================================

  /**
   * Create a new branch pointing to the current HEAD (or specified oid).
   * Note: only creates a ref; does not create any commits.
   */
  async createBranch(name, fromOid = null) {
    if (!this.headOid) await this.init();
    const sourceOid = fromOid || this.headOid;

    // Create an empty packfile (branch creation doesn't need new objects if fromOid exists)
    const emptyPack = await encodePackfile([]);

    const result = await gitReceivePack(this.url, {
      oldOid: ZERO_OID,
      newOid: sourceOid,
      ref: `refs/heads/${name}`,
      packfile: emptyPack,
      token: this.token,
    });

    return {
      ok: result.ok,
      branch: name,
      pointsTo: sourceOid,
      refs: result.refs,
    };
  }

  /**
   * Delete a branch from the remote.
   */
  async deleteBranch(name) {
    // Always fetch fresh refs — a branch may have been created after init()
    const refs = await lsRefs(this.url, { token: this.token });
    const branchRef = `refs/heads/${name}`;
    const ref = refs.find((r) => r.refName === branchRef);
    if (!ref) throw new Error(`Branch not found: ${name}`);

    const emptyPack = await encodePackfile([]);

    const result = await gitReceivePack(this.url, {
      oldOid: ref.oid,
      newOid: ZERO_OID,
      ref: branchRef,
      packfile: emptyPack,
      token: this.token,
    });

    return {
      ok: result.ok,
      branch: name,
      refs: result.refs,
    };
  }
}
