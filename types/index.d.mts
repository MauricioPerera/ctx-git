/**
 * Compute the git SHA-1 OID of an object.
 * Uses Web Crypto API — works in all modern runtimes.
 */
export function gitOid(type: any, data: any): Promise<string>;
export const ZERO_OID: "0000000000000000000000000000000000000000";
/**
 * A ctx-git repository handle with read/write access.
 * Maintains an in-memory object store that accumulates fetched objects
 * (lazy hydration pattern).
 */
export class CtxGitRepo {
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
    static formatMap(node: any, indent?: string): string;
    constructor(url: any, options?: {});
    url: any;
    token: any;
    branch: any;
    /** @type {Map<string, { type: string, data: Uint8Array }>} */
    objects: Map<string, {
        type: string;
        data: Uint8Array;
    }>;
    headOid: any;
    headTreeOid: any;
    /**
     * Discover server capabilities and resolve the branch head.
     */
    init(): Promise<{
        headOid: any;
        caps: any;
        refs: {
            oid: string;
            refName: string;
            symref?: string;
        }[];
    }>;
    refs: {
        oid: string;
        refName: string;
        symref?: string;
    }[];
    /**
     * List all branches available on the remote.
     */
    listBranches(): Promise<{
        name: string;
        oid: string;
    }[]>;
    /**
     * Fetch commits + trees (no blobs) from the current branch head.
     */
    hydrateStructure(): Promise<{
        numObjects: number;
        packBytes: number;
    }>;
    /**
     * List all files (blobs) recursively from the current HEAD tree.
     */
    listFiles(treeOid?: any, prefix?: string): any;
    findBlobOid(path: any): any;
    /**
     * Read a blob by OID. Fetches on-demand if not in store.
     */
    readBlob(oid: any): Promise<any>;
    /**
     * Read a file by path.
     */
    readFile(path: any): Promise<string>;
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
    readMap(options?: {
        indexFile?: string;
        rootPath?: string;
        maxDepth?: number;
        includeFileList?: boolean;
    }): Promise<{
        path: any;
        description: any;
        files: any[];
        subfolders: any[];
    }>;
    _buildMap(treeOid: any, prefix: any, indexFile: any, maxDepth: any, depth: any, includeFileList: any): Promise<{
        path: any;
        description: any;
        files: any[];
        subfolders: any[];
    }>;
    /**
     * Write a single file and push in one shot.
     * Convenience wrapper around `writeFiles`.
     */
    writeFile(path: any, content: any, commitInfo: any, options?: {}): Promise<any>;
    /**
     * Delete a single file and push in one shot.
     */
    deleteFile(path: any, commitInfo: any, options?: {}): Promise<any>;
    /**
     * Write/delete multiple files in a single commit.
     *
     * @param {Array<{ path: string, content?: string, delete?: boolean }>} operations
     * @param {{ message: string, author: { name: string, email: string } }} commitInfo
     * @param {{ maxRetries?: number }} options — retry on non-fast-forward (default 3)
     */
    writeFiles(operations: Array<{
        path: string;
        content?: string;
        delete?: boolean;
    }>, commitInfo: {
        message: string;
        author: {
            name: string;
            email: string;
        };
    }, options?: {
        maxRetries?: number;
    }): Promise<any>;
    _treeEntries(treeOid: any): {
        mode: string;
        name: string;
        oid: string;
        type: "blob" | "tree" | "commit";
    }[];
    _prepareCommit(operations: any, commitInfo: any): any;
    /**
     * Recursively walk down `parts` from the given tree, creating/updating/deleting
     * entries along the way.
     */
    _updateTreePath(currentTreeOid: any, parts: any, targetOid: any, targetMode: any, newObjects: any, opts?: {}): Promise<string>;
    _fetchTree(treeOid: any): Promise<void>;
    /**
     * Create a new branch pointing to the current HEAD (or specified oid).
     * Note: only creates a ref; does not create any commits.
     */
    createBranch(name: any, fromOid?: any): Promise<{
        ok: boolean;
        branch: any;
        pointsTo: any;
        refs: {
            ref: string;
            ok: boolean;
            reason?: string;
        }[];
    }>;
    /**
     * Delete a branch from the remote.
     */
    deleteBranch(name: any): Promise<{
        ok: boolean;
        branch: any;
        refs: {
            ref: string;
            ok: boolean;
            reason?: string;
        }[];
    }>;
}
