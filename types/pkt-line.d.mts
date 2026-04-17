/**
 * Encode a pkt-line.
 * @param {string | Uint8Array | null} data — string, bytes, or null/empty for flush-pkt
 * @returns {Uint8Array}
 */
export function encode(data: string | Uint8Array | null): Uint8Array;
/**
 * Parse a stream of pkt-lines.
 * Returns an array of chunks. Each chunk is either:
 *   { type: "flush" }
 *   { type: "delim" }
 *   { type: "response-end" }
 *   { type: "data", payload: Uint8Array, text: string }
 *
 * @param {Uint8Array} buffer
 * @returns {{ chunks: Array, remaining: Uint8Array }}
 */
export function parseStream(buffer: Uint8Array): {
    chunks: any[];
    remaining: Uint8Array;
};
/**
 * Special control packets.
 */
export const FLUSH_PKT: Uint8Array<ArrayBuffer>;
export const DELIM_PKT: Uint8Array<ArrayBuffer>;
export const RESPONSE_END_PKT: Uint8Array<ArrayBuffer>;
export { concat } from "./utils.mjs";
