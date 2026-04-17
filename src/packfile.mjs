// Git packfile parser.
// Uses node:zlib (available in Workers via nodejs_compat flag).
//
// https://git-scm.com/docs/pack-format

import zlib from "node:zlib";
import { bytesToHex } from "./utils.mjs";

export const OBJ_COMMIT = 1;
export const OBJ_TREE = 2;
export const OBJ_BLOB = 3;
export const OBJ_TAG = 4;
export const OBJ_OFS_DELTA = 6;
export const OBJ_REF_DELTA = 7;

export const TYPE_NAMES = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
  6: "ofs-delta",
  7: "ref-delta",
};

export async function parsePackfile(packData) {
  if (packData.length < 12 + 20) {
    throw new Error(`Packfile too short: ${packData.length} bytes`);
  }

  // Validate magic
  const magic =
    String.fromCharCode(packData[0]) +
    String.fromCharCode(packData[1]) +
    String.fromCharCode(packData[2]) +
    String.fromCharCode(packData[3]);
  if (magic !== "PACK") {
    throw new Error(`Invalid pack magic: "${magic}"`);
  }

  const version = readUint32BE(packData, 4);
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported pack version: ${version}`);
  }

  const numObjects = readUint32BE(packData, 8);

  const objects = [];
  let offset = 12;
  const endOffset = packData.length - 20;

  for (let i = 0; i < numObjects; i++) {
    if (offset >= endOffset) {
      throw new Error(`Packfile corrupt at object ${i}/${numObjects}`);
    }
    const obj = await parseObject(packData, offset);
    objects.push(obj);
    offset = obj.nextOffset;
  }

  return { version, numObjects, objects };
}

async function parseObject(packData, startOffset) {
  let offset = startOffset;

  // Variable-length header
  let byte = packData[offset++];
  const type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;

  while (byte & 0x80) {
    byte = packData[offset++];
    size |= (byte & 0x7f) << shift;
    shift += 7;
  }

  let baseOffset;
  let baseOid;

  if (type === OBJ_OFS_DELTA) {
    byte = packData[offset++];
    let backOffset = byte & 0x7f;
    while (byte & 0x80) {
      backOffset += 1;
      byte = packData[offset++];
      backOffset = (backOffset << 7) | (byte & 0x7f);
    }
    baseOffset = startOffset - backOffset;
  } else if (type === OBJ_REF_DELTA) {
    const sha = packData.slice(offset, offset + 20);
    baseOid = bytesToHex(sha);
    offset += 20;
  }

  const { decompressed, bytesConsumed } = inflateTracked(
    packData,
    offset,
    size,
  );

  return {
    type,
    typeName: TYPE_NAMES[type] || `unknown-${type}`,
    size,
    offset: startOffset,
    data: decompressed,
    baseOffset,
    baseOid,
    nextOffset: offset + bytesConsumed,
  };
}

/**
 * Inflate using node:zlib with binary search to find consumed bytes.
 * Node.js's zlib.inflateSync is lenient — ignores trailing bytes.
 * This makes it easy to inflate without knowing the exact stream length.
 */
function inflateTracked(packData, offset, expectedSize) {
  const input = packData.slice(offset);

  // Inflate the full remainder; zlib.inflateSync ignores trailing bytes.
  const decompressed = zlib.inflateSync(input);

  if (decompressed.length !== expectedSize) {
    throw new Error(
      `Size mismatch: expected ${expectedSize}, got ${decompressed.length}`,
    );
  }

  // Binary search to find minimum input length that still yields expected output.
  let lo = 1;
  let hi = input.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    try {
      const r = zlib.inflateSync(input.slice(0, mid));
      if (r.length === expectedSize) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    } catch {
      lo = mid + 1;
    }
  }

  return {
    decompressed: new Uint8Array(
      decompressed.buffer,
      decompressed.byteOffset,
      decompressed.byteLength,
    ),
    bytesConsumed: lo,
  };
}

// Helpers

function readUint32BE(buf, offset) {
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}

