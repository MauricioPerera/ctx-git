/**
 * Compute the OID of an object (SHA-1 of "<type> <size>\0<content>").
 */
export function computeOid(type: any, content: any): Promise<string>;
/**
 * Encode a tree object from an array of entries.
 *
 * Format (binary):
 *   Repeated: <mode ASCII> <SP> <name> <NUL> <20-byte SHA-1>
 *
 * Entries must be sorted by name (git requirement). We sort here if not already.
 *
 * @param {Array<{ mode: string, name: string, oid: string }>} entries
 * @returns {Uint8Array}
 */
export function encodeTree(entries: Array<{
    mode: string;
    name: string;
    oid: string;
}>): Uint8Array;
/**
 * Encode a commit object.
 *
 * Format:
 *   tree <oid>\n
 *   parent <oid>\n (0 or more)
 *   author <name> <email> <timestamp> <tz>\n
 *   committer <name> <email> <timestamp> <tz>\n
 *   \n
 *   <message>
 */
export function encodeCommit({ tree, parents, author, committer, message }: {
    tree: any;
    parents?: any[];
    author: any;
    committer: any;
    message: any;
}): Uint8Array<ArrayBuffer>;
/**
 * Format a git person+timestamp string.
 * Example: "Mauricio <maurik@example.com> 1713292800 +0000"
 */
export function formatPerson(name: any, email: any, timestampSeconds?: any, tz?: string): string;
/**
 * Encode a packfile containing the given objects.
 *
 * @param {Array<{ type: 'commit'|'tree'|'blob', content: Uint8Array }>} objects
 * @returns {Promise<Uint8Array>} packfile bytes including 20-byte SHA-1 trailer
 */
export function encodePackfile(objects: Array<{
    type: "commit" | "tree" | "blob";
    content: Uint8Array;
}>): Promise<Uint8Array>;
