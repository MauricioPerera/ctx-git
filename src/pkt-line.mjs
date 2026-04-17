// pkt-line: Git's framing format for smart HTTP protocol.
// https://git-scm.com/docs/protocol-common#_pkt_line_format
//
// Format: 4 hex chars for length (includes the 4 bytes of length itself) + data
// Special packets:
//   "0000" = flush-pkt
//   "0001" = delim-pkt (protocol v2)
//   "0002" = response-end-pkt (protocol v2)

const te = new TextEncoder();
const td = new TextDecoder();

/**
 * Encode a pkt-line.
 * @param {string | Uint8Array | null} data — string, bytes, or null/empty for flush-pkt
 * @returns {Uint8Array}
 */
export function encode(data) {
  if (data === null || data === undefined) {
    // flush-pkt
    return te.encode("0000");
  }
  const bytes = typeof data === "string" ? te.encode(data) : data;
  const totalLen = bytes.length + 4;
  if (totalLen > 0xffff) {
    throw new Error(`pkt-line exceeds max size: ${totalLen}`);
  }
  const prefix = te.encode(totalLen.toString(16).padStart(4, "0"));
  const out = new Uint8Array(prefix.length + bytes.length);
  out.set(prefix, 0);
  out.set(bytes, prefix.length);
  return out;
}

/**
 * Special control packets.
 */
export const FLUSH_PKT = te.encode("0000");
export const DELIM_PKT = te.encode("0001");
export const RESPONSE_END_PKT = te.encode("0002");

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
export function parseStream(buffer) {
  const chunks = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    // Read length prefix (4 hex chars)
    const lenBytes = buffer.slice(offset, offset + 4);
    const lenStr = td.decode(lenBytes);
    const len = parseInt(lenStr, 16);

    if (Number.isNaN(len)) {
      throw new Error(`Invalid pkt-line length: "${lenStr}" at offset ${offset}`);
    }

    if (len === 0) {
      chunks.push({ type: "flush" });
      offset += 4;
      continue;
    }
    if (len === 1) {
      chunks.push({ type: "delim" });
      offset += 4;
      continue;
    }
    if (len === 2) {
      chunks.push({ type: "response-end" });
      offset += 4;
      continue;
    }
    if (len < 4) {
      throw new Error(`Invalid pkt-line length < 4: ${len}`);
    }

    // Data packet: len includes 4 bytes of prefix
    const dataLen = len - 4;
    if (offset + 4 + dataLen > buffer.length) {
      // Incomplete packet, leave in remaining buffer
      break;
    }

    const payload = buffer.slice(offset + 4, offset + 4 + dataLen);
    chunks.push({
      type: "data",
      payload,
      text: td.decode(payload),
    });
    offset += 4 + dataLen;
  }

  return {
    chunks,
    remaining: buffer.slice(offset),
  };
}

// concat is re-exported from utils for historical import paths
export { concat } from "./utils.mjs";
