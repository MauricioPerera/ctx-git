/**
 * Push a packfile to update a ref.
 *
 * @param {string} repoUrl
 * @param {object} params
 * @param {string} params.oldOid — existing ref value (or "0000000000000000000000000000000000000000" for create)
 * @param {string} params.newOid — new ref value
 * @param {string} params.ref — e.g. "refs/heads/main"
 * @param {Uint8Array} params.packfile — encoded packfile
 * @param {string} [params.token]
 * @returns {Promise<{ ok: boolean, unpack: string, refs: Array<{ ref: string, ok: boolean, reason?: string }>, raw: string }>}
 */
export function gitReceivePack(repoUrl: string, params: {
    oldOid: string;
    newOid: string;
    ref: string;
    packfile: Uint8Array;
    token?: string;
}): Promise<{
    ok: boolean;
    unpack: string;
    refs: Array<{
        ref: string;
        ok: boolean;
        reason?: string;
    }>;
    raw: string;
}>;
