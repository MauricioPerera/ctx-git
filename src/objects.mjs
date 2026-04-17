// Git object parsers: commit, tree, blob.
// https://git-scm.com/book/en/v2/Git-Internals-Git-Objects

import { bytesToHex } from "./utils.mjs";

const td = new TextDecoder();

/**
 * Parse a commit object.
 * Format (text):
 *   tree <oid>\n
 *   parent <oid>\n (repeated, 0 or more)
 *   author <name> <email> <timestamp> <tz>\n
 *   committer <name> <email> <timestamp> <tz>\n
 *   \n
 *   <message>
 *
 * @param {Uint8Array} data
 * @returns {{ tree: string, parents: string[], author: string, committer: string, message: string }}
 */
export function parseCommit(data) {
  const text = td.decode(data);
  const headerEnd = text.indexOf("\n\n");
  if (headerEnd === -1) throw new Error("Invalid commit: no header terminator");

  const headerLines = text.slice(0, headerEnd).split("\n");
  const message = text.slice(headerEnd + 2);

  let tree = null;
  const parents = [];
  let author = "";
  let committer = "";

  for (const line of headerLines) {
    if (line.startsWith("tree ")) tree = line.slice(5);
    else if (line.startsWith("parent ")) parents.push(line.slice(7));
    else if (line.startsWith("author ")) author = line.slice(7);
    else if (line.startsWith("committer ")) committer = line.slice(10);
  }

  if (!tree) throw new Error("Invalid commit: no tree");
  return { tree, parents, author, committer, message };
}

/**
 * Parse a tree object.
 * Format (binary):
 *   Sequence of entries:
 *     <mode ASCII> <SP> <name> <NUL> <20 bytes SHA-1 binary>
 *
 * @param {Uint8Array} data
 * @returns {Array<{ mode: string, name: string, oid: string, type: 'blob' | 'tree' | 'commit' }>}
 */
export function parseTree(data) {
  const entries = [];
  let offset = 0;

  while (offset < data.length) {
    // Read mode (ASCII digits) until space
    const spaceIdx = data.indexOf(0x20, offset);
    if (spaceIdx === -1) throw new Error("Invalid tree: no space after mode");
    const mode = td.decode(data.slice(offset, spaceIdx));

    // Read name until NUL
    const nulIdx = data.indexOf(0x00, spaceIdx + 1);
    if (nulIdx === -1) throw new Error("Invalid tree: no NUL after name");
    const name = td.decode(data.slice(spaceIdx + 1, nulIdx));

    // Read 20-byte SHA-1
    if (nulIdx + 1 + 20 > data.length) {
      throw new Error("Invalid tree: truncated SHA");
    }
    const oidBytes = data.slice(nulIdx + 1, nulIdx + 1 + 20);
    const oid = bytesToHex(oidBytes);

    // Infer type from mode
    // 040000 = tree, 100644/100755 = blob (file), 120000 = symlink (blob), 160000 = commit (submodule)
    let type = "blob";
    if (mode === "40000" || mode === "040000") type = "tree";
    else if (mode === "160000") type = "commit";

    entries.push({ mode, name, oid, type });
    offset = nulIdx + 1 + 20;
  }

  return entries;
}

/**
 * A blob is just the raw bytes. This helper returns it as a string (UTF-8 assumed).
 */
export function blobToString(data) {
  return td.decode(data);
}

