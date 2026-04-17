// Shared utility helpers used across ctx-git modules.
// Kept small and dependency-free.

/**
 * Convert a Uint8Array (or any iterable of bytes 0-255) to a lowercase hex string.
 * @param {Uint8Array | Iterable<number>} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  const hex = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, "0"));
  return hex.join("");
}

/**
 * Convert a hex string to a Uint8Array. Throws on invalid input.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (typeof hex !== "string") {
    throw new TypeError(`hexToBytes expected string, got ${typeof hex}`);
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${hex.length} (must be even)`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const chunk = hex.slice(i * 2, i * 2 + 2);
    const value = parseInt(chunk, 16);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid hex character in "${chunk}" at position ${i * 2}`);
    }
    bytes[i] = value;
  }
  return bytes;
}

/**
 * Concatenate multiple Uint8Array into one new buffer.
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
export function concat(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * Normalize a repo URL by stripping trailing .git and trailing slash.
 * We append ".git/<path>" internally; this avoids double ".git.git/" etc.
 * @param {string} url
 * @returns {string}
 */
export function stripDotGit(url) {
  return url.replace(/\.git\/?$/, "").replace(/\/$/, "");
}

/**
 * Build the HTTP Basic auth header value for a git server.
 * Works with GitHub / GitLab / most servers that accept any username.
 * @param {string} token
 * @returns {string} "Basic <base64>"
 */
export function basicAuth(token) {
  return `Basic ${btoa(`x-access-token:${token}`)}`;
}

/**
 * Shared User-Agent for all HTTP requests.
 */
export const USER_AGENT = "ctx-git/0.1";
