// Encode git objects and packfiles for writing.
// Inverse of objects.mjs (parse) and packfile.mjs (parse).

import zlib from "node:zlib";
import { bytesToHex, hexToBytes, concat } from "./utils.mjs";

const te = new TextEncoder();

/**
 * Compute the OID of an object (SHA-1 of "<type> <size>\0<content>").
 */
export async function computeOid(type, content) {
  const header = te.encode(`${type} ${content.length}\0`);
  const combined = new Uint8Array(header.length + content.length);
  combined.set(header, 0);
  combined.set(content, header.length);
  const hashBuf = await crypto.subtle.digest("SHA-1", combined);
  return bytesToHex(new Uint8Array(hashBuf));
}

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
export function encodeTree(entries) {
  // Sort entries: git sorts trees slightly differently — trees (mode 40000) are
  // sorted as if their name had a trailing "/". But for simplicity with typical
  // names, lexicographic sort works. For strict correctness we handle the
  // trailing-slash comparison.
  const sorted = [...entries].sort((a, b) => {
    const aKey = a.mode === "40000" || a.mode === "040000" ? a.name + "/" : a.name;
    const bKey = b.mode === "40000" || b.mode === "040000" ? b.name + "/" : b.name;
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });

  // Compute total size
  const parts = [];
  for (const entry of sorted) {
    // Normalize mode: git stores tree mode as "40000" not "040000"
    const mode = entry.mode === "040000" ? "40000" : entry.mode;
    const modeBytes = te.encode(mode);
    const nameBytes = te.encode(entry.name);
    const oidBytes = hexToBytes(entry.oid);
    if (oidBytes.length !== 20) {
      throw new Error(`Invalid OID length for ${entry.name}: ${oidBytes.length}`);
    }

    const entrySize = modeBytes.length + 1 + nameBytes.length + 1 + 20;
    const buf = new Uint8Array(entrySize);
    let off = 0;
    buf.set(modeBytes, off);
    off += modeBytes.length;
    buf[off++] = 0x20; // space
    buf.set(nameBytes, off);
    off += nameBytes.length;
    buf[off++] = 0x00; // NUL
    buf.set(oidBytes, off);
    parts.push(buf);
  }

  // Concatenate
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

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
export function encodeCommit({ tree, parents = [], author, committer, message }) {
  let text = `tree ${tree}\n`;
  for (const p of parents) text += `parent ${p}\n`;
  text += `author ${author}\n`;
  text += `committer ${committer}\n`;
  text += `\n`;
  text += message;
  if (!message.endsWith("\n")) text += "\n";
  return te.encode(text);
}

/**
 * Format a git person+timestamp string.
 * Example: "Mauricio <maurik@example.com> 1713292800 +0000"
 */
export function formatPerson(name, email, timestampSeconds = null, tz = "+0000") {
  const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);
  return `${name} <${email}> ${ts} ${tz}`;
}

/**
 * Encode a packfile containing the given objects.
 *
 * @param {Array<{ type: 'commit'|'tree'|'blob', content: Uint8Array }>} objects
 * @returns {Promise<Uint8Array>} packfile bytes including 20-byte SHA-1 trailer
 */
export async function encodePackfile(objects) {
  const TYPE_NUMS = { commit: 1, tree: 2, blob: 3, tag: 4 };

  // Header: PACK (4) + version=2 (4) + numObjects (4)
  const header = new Uint8Array(12);
  header[0] = 0x50; // 'P'
  header[1] = 0x41; // 'A'
  header[2] = 0x43; // 'C'
  header[3] = 0x4b; // 'K'
  writeUint32BE(header, 4, 2); // version
  writeUint32BE(header, 8, objects.length);

  const bodyParts = [header];

  for (const obj of objects) {
    const typeNum = TYPE_NUMS[obj.type];
    if (!typeNum) throw new Error(`Unknown type: ${obj.type}`);

    // Encode object header (variable-length type+size)
    const objHeader = encodeObjectHeader(typeNum, obj.content.length);

    // Compress content with zlib
    const compressed = zlib.deflateSync(Buffer.from(obj.content));

    bodyParts.push(objHeader, new Uint8Array(compressed));
  }

  // Concatenate everything except the trailer
  const body = concat(bodyParts);

  // Compute SHA-1 of the body
  const shaBuf = await crypto.subtle.digest("SHA-1", body);
  const sha = new Uint8Array(shaBuf);

  // Final packfile = body + 20-byte SHA-1
  const pack = new Uint8Array(body.length + 20);
  pack.set(body, 0);
  pack.set(sha, body.length);
  return pack;
}

/**
 * Encode the variable-length object header used in packfiles.
 *
 * Byte 1: MSB (1 bit) | type (3 bits) | size low (4 bits)
 * Additional bytes: MSB (1 bit) | size bits (7 bits)
 */
function encodeObjectHeader(type, size) {
  const bytes = [];
  let firstByte = (type << 4) | (size & 0x0f);
  size >>>= 4;
  if (size > 0) firstByte |= 0x80;
  bytes.push(firstByte);

  while (size > 0) {
    let b = size & 0x7f;
    size >>>= 7;
    if (size > 0) b |= 0x80;
    bytes.push(b);
  }

  return new Uint8Array(bytes);
}

// Helpers (module-local)

function writeUint32BE(buf, offset, value) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}
