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
export function parseCommit(data: Uint8Array): {
    tree: string;
    parents: string[];
    author: string;
    committer: string;
    message: string;
};
/**
 * Parse a tree object.
 * Format (binary):
 *   Sequence of entries:
 *     <mode ASCII> <SP> <name> <NUL> <20 bytes SHA-1 binary>
 *
 * @param {Uint8Array} data
 * @returns {Array<{ mode: string, name: string, oid: string, type: 'blob' | 'tree' | 'commit' }>}
 */
export function parseTree(data: Uint8Array): Array<{
    mode: string;
    name: string;
    oid: string;
    type: "blob" | "tree" | "commit";
}>;
/**
 * A blob is just the raw bytes. This helper returns it as a string (UTF-8 assumed).
 */
export function blobToString(data: any): string;
