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
    headTreeOid: string;
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
    _prepareCommit(operations: any, commitInfo: any): Promise<{
        newCommitOid: string;
        newObjects: {
            type: string;
            oid: string;
            content: Uint8Array<ArrayBuffer>;
        }[];
    }>;
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
