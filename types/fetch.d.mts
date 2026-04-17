/**
 * Fetch objects from remote.
 *
 * @param {string} repoUrl
 * @param {object} options
 * @param {string[]} options.wants — list of OIDs we want
 * @param {string[]} [options.haves] — OIDs we already have
 * @param {string} [options.filter] — e.g. "blob:none" for blobless
 * @param {number} [options.depth] — shallow clone depth
 * @param {boolean} [options.done] — signal we're done negotiating
 * @param {string} [options.token]
 * @returns {Promise<{ packData: Uint8Array, progress: string[], shallow: string[] }>}
 */
export function fetchObjects(repoUrl: string, options?: {
    wants: string[];
    haves?: string[];
    filter?: string;
    depth?: number;
    done?: boolean;
    token?: string;
}): Promise<{
    packData: Uint8Array;
    progress: string[];
    shallow: string[];
}>;
