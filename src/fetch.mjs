// Fetch command implementation (protocol v2).
// https://git-scm.com/docs/protocol-v2#_fetch
//
// Flow:
//   POST /git-upload-pack
//   Body: pkt-lines containing command=fetch + args + wants + filter
//   Response: multiplexed sideband (pkt-lines with band prefix)
//     Band 1: pack data
//     Band 2: progress messages
//     Band 3: error messages

import { encode, parseStream, concat, FLUSH_PKT, DELIM_PKT } from "./pkt-line.mjs";

const USER_AGENT = "ctx-git/0.1";

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
export async function fetchObjects(repoUrl, options = {}) {
  if (!options.wants || options.wants.length === 0) {
    throw new Error("fetchObjects requires at least one 'want' OID");
  }

  const url = `${stripDotGit(repoUrl)}.git/git-upload-pack`;
  const body = buildFetchRequest(options);

  const headers = {
    "User-Agent": USER_AGENT,
    "Git-Protocol": "version=2",
    "Content-Type": "application/x-git-upload-pack-request",
    Accept: "application/x-git-upload-pack-result",
  };
  if (options.token) {
    const basic = btoa(`x-access-token:${options.token}`);
    headers.Authorization = `Basic ${basic}`;
  }

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `fetch failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  return parseFetchResponse(buffer);
}

/**
 * Build fetch request body.
 *
 * Protocol v2 fetch body format:
 *   command=fetch\n
 *   agent=...\n          (optional)
 *   object-format=sha1\n  (optional)
 *   0001                  (delim-pkt)
 *   want <oid>\n          (repeated)
 *   have <oid>\n          (repeated, optional)
 *   filter <spec>\n       (optional)
 *   deepen <n>\n          (optional)
 *   done\n                (optional: end negotiation)
 *   0000                  (flush-pkt)
 */
function buildFetchRequest(options) {
  const pkts = [
    encode("command=fetch\n"),
    encode(`agent=${USER_AGENT}\n`),
    encode("object-format=sha1\n"),
    DELIM_PKT,
  ];

  for (const oid of options.wants) {
    pkts.push(encode(`want ${oid}\n`));
  }
  for (const oid of options.haves || []) {
    pkts.push(encode(`have ${oid}\n`));
  }
  if (options.filter) {
    pkts.push(encode(`filter ${options.filter}\n`));
  }
  if (options.depth) {
    pkts.push(encode(`deepen ${options.depth}\n`));
  }

  // Include ofs-delta for smaller packfiles
  pkts.push(encode("ofs-delta\n"));

  // "done" tells server we're finished negotiating (no further haves coming)
  if (options.done !== false) {
    pkts.push(encode("done\n"));
  }

  pkts.push(FLUSH_PKT);
  return concat(pkts);
}

/**
 * Parse fetch response with sideband multiplexing.
 *
 * Response structure (v2):
 *   Optional sections (each prefixed by a section header):
 *     "acknowledgments\n"   — ACK/NAK lines
 *     "shallow-info\n"      — shallow boundaries
 *     "wanted-refs\n"
 *     "packfile\n"          — followed by sideband-encoded packfile
 *
 * Sideband format (inside "packfile" section):
 *   Each data pkt-line starts with 1 byte:
 *     0x01 = pack data
 *     0x02 = progress message (stderr)
 *     0x03 = error
 *
 * @returns {{ packData: Uint8Array, progress: string[], shallow: string[], acks: string[] }}
 */
function parseFetchResponse(buffer) {
  const { chunks } = parseStream(buffer);

  const packChunks = [];
  const progress = [];
  const shallow = [];
  const acks = [];
  let currentSection = null;

  for (const chunk of chunks) {
    if (chunk.type === "flush") {
      currentSection = null;
      continue;
    }
    if (chunk.type === "delim") {
      currentSection = null;
      continue;
    }
    if (chunk.type !== "data") continue;

    const text = chunk.text;
    const payload = chunk.payload;

    // Check if this is a section header
    const trimmed = text.trimEnd();
    if (
      trimmed === "acknowledgments" ||
      trimmed === "shallow-info" ||
      trimmed === "wanted-refs" ||
      trimmed === "packfile"
    ) {
      currentSection = trimmed;
      continue;
    }

    // Process based on current section
    if (currentSection === "packfile") {
      // First byte is the sideband indicator
      if (payload.length < 1) continue;
      const band = payload[0];
      const data = payload.slice(1);
      if (band === 0x01) {
        // pack data
        packChunks.push(data);
      } else if (band === 0x02) {
        // progress
        progress.push(new TextDecoder().decode(data));
      } else if (band === 0x03) {
        // error
        progress.push(`ERROR: ${new TextDecoder().decode(data)}`);
      }
      continue;
    }

    if (currentSection === "shallow-info") {
      if (trimmed.startsWith("shallow ")) {
        shallow.push(trimmed.slice("shallow ".length));
      }
      continue;
    }

    if (currentSection === "acknowledgments") {
      acks.push(trimmed);
      continue;
    }

    // Fallback: pre-v2 behavior or unknown section
    // In some servers responses may contain raw NAK/pack data without sections
    if (trimmed === "NAK" || trimmed === "ACK" || trimmed.startsWith("ACK ")) {
      acks.push(trimmed);
    }
  }

  return {
    packData: concat(packChunks),
    progress,
    shallow,
    acks,
  };
}

function stripDotGit(url) {
  return url.replace(/\.git\/?$/, "").replace(/\/$/, "");
}
