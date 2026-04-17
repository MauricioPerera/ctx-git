/**
 * Convert a Uint8Array (or any iterable of bytes 0-255) to a lowercase hex string.
 * @param {Uint8Array | Iterable<number>} bytes
 * @returns {string}
 */
export function bytesToHex(bytes: Uint8Array | Iterable<number>): string;
/**
 * Convert a hex string to a Uint8Array. Throws on invalid input.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex: string): Uint8Array;
/**
 * Concatenate multiple Uint8Array into one new buffer.
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
export function concat(arrays: Uint8Array[]): Uint8Array;
/**
 * Normalize a repo URL by stripping trailing .git and trailing slash.
 * We append ".git/<path>" internally; this avoids double ".git.git/" etc.
 * @param {string} url
 * @returns {string}
 */
export function stripDotGit(url: string): string;
/**
 * Build the HTTP Basic auth header value for a git server.
 * Works with GitHub / GitLab / most servers that accept any username.
 * @param {string} token
 * @returns {string} "Basic <base64>"
 */
export function basicAuth(token: string): string;
/**
 * Shared User-Agent for all HTTP requests.
 */
export const USER_AGENT: "ctx-git/0.1";
