/**
 * Discover server capabilities via info/refs endpoint.
 * This also negotiates protocol v2.
 *
 * @param {string} repoUrl — base URL like https://github.com/user/repo.git
 * @param {object} options
 * @param {string} [options.token] — bearer/basic auth token
 * @returns {Promise<{ capabilities: Map<string, string[]>, agent: string, protocolVersion: number }>}
 */
export function discoverCapabilities(repoUrl: string, options?: {
    token?: string;
}): Promise<{
    capabilities: Map<string, string[]>;
    agent: string;
    protocolVersion: number;
}>;
/**
 * Execute the `ls-refs` command to list remote refs.
 *
 * @param {string} repoUrl
 * @param {object} options
 * @param {string} [options.token]
 * @param {string[]} [options.refPrefixes] — e.g. ["refs/heads/"]
 * @returns {Promise<Array<{ oid: string, refName: string, symref?: string }>>}
 */
export function lsRefs(repoUrl: string, options?: {
    token?: string;
    refPrefixes?: string[];
}): Promise<Array<{
    oid: string;
    refName: string;
    symref?: string;
}>>;
