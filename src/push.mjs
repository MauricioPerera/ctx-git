// git-receive-pack: push a packfile to update a ref.
// Protocol v1 (v2 does not support push).
//
// Flow:
//   1. GET /info/refs?service=git-receive-pack → advertisement of server refs
//   2. POST /git-receive-pack with:
//      Body: "<old-oid> <new-oid> <ref>\0<capabilities>\n" + flush-pkt + raw packfile
//      Response: pkt-lines with "unpack ok", "ok <ref>" or "ng <ref> <reason>"

import { encode, parseStream, FLUSH_PKT } from "./pkt-line.mjs";
import { concat, stripDotGit, basicAuth, USER_AGENT } from "./utils.mjs";

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
export async function gitReceivePack(repoUrl, params) {
  const { oldOid, newOid, ref, packfile, token } = params;

  const url = `${stripDotGit(repoUrl)}.git/git-receive-pack`;

  // Build the request body
  // First line format:
  //   "<old-oid> <new-oid> <ref>\0<capabilities>"
  // Capabilities we request:
  //   report-status — get detailed response of per-ref status
  //   side-band-64k — (optional) server can use sideband for errors
  //
  const capabilities = "report-status";
  const firstLine = `${oldOid} ${newOid} ${ref}\0${capabilities}\n`;

  const pkts = [
    encode(firstLine),
    FLUSH_PKT,
  ];
  const commandBytes = concat(pkts);

  // Append raw packfile bytes (NOT pkt-line encoded)
  const body = new Uint8Array(commandBytes.length + packfile.length);
  body.set(commandBytes, 0);
  body.set(packfile, commandBytes.length);

  const headers = {
    "User-Agent": USER_AGENT,
    "Content-Type": "application/x-git-receive-pack-request",
    Accept: "application/x-git-receive-pack-result",
  };
  if (token) {
    headers.Authorization = basicAuth(token);
  }

  const res = await fetch(url, { method: "POST", headers, body });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `receive-pack failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
  }

  const responseBytes = new Uint8Array(await res.arrayBuffer());
  return parseReceivePackResponse(responseBytes);
}

/**
 * Parse the response from git-receive-pack.
 *
 * Format (with report-status):
 *   unpack ok\n
 *   ok <refname>\n       (for each ref updated successfully)
 *   ng <refname> <msg>\n (for each ref that failed)
 *   flush-pkt
 */
function parseReceivePackResponse(bytes) {
  const { chunks } = parseStream(bytes);

  let unpack = null;
  const refs = [];
  const raw = [];

  for (const chunk of chunks) {
    if (chunk.type !== "data") continue;
    const line = chunk.text.trimEnd();
    raw.push(line);

    if (line.startsWith("unpack ")) {
      unpack = line.slice("unpack ".length);
    } else if (line.startsWith("ok ")) {
      refs.push({ ref: line.slice(3), ok: true });
    } else if (line.startsWith("ng ")) {
      const rest = line.slice(3);
      const spaceIdx = rest.indexOf(" ");
      const refname = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      const reason = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1);
      refs.push({ ref: refname, ok: false, reason });
    }
  }

  const ok = unpack === "ok" && refs.every((r) => r.ok);

  return { ok, unpack, refs, raw };
}

