// Git Smart HTTP Protocol v2 client.
// https://git-scm.com/docs/protocol-v2
//
// Flow:
//   1. GET info/refs?service=git-upload-pack  → capability advertisement (we use v2 by sending header)
//   2. POST git-upload-pack with command=ls-refs → list of refs
//   3. POST git-upload-pack with command=fetch [+ filters] → packfile response

import { encode, parseStream, FLUSH_PKT, DELIM_PKT } from "./pkt-line.mjs";
import { concat, stripDotGit, basicAuth, USER_AGENT } from "./utils.mjs";

/**
 * Discover server capabilities via info/refs endpoint.
 * This also negotiates protocol v2.
 *
 * @param {string} repoUrl — base URL like https://github.com/user/repo.git
 * @param {object} options
 * @param {string} [options.token] — bearer/basic auth token
 * @returns {Promise<{ capabilities: Map<string, string[]>, agent: string, protocolVersion: number }>}
 */
export async function discoverCapabilities(repoUrl, options = {}) {
  const url = `${stripDotGit(repoUrl)}.git/info/refs?service=git-upload-pack`;
  const headers = {
    "User-Agent": USER_AGENT,
    "Git-Protocol": "version=2",
    Accept: "application/x-git-upload-pack-advertisement",
  };
  if (options.token) {
    headers.Authorization = basicAuth(options.token);
  }

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(`Discovery failed: ${res.status} ${res.statusText}`);
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  const { chunks } = parseStream(buffer);

  // Protocol v2 response starts with "# service=git-upload-pack\n" (optional, then flush)
  // Followed by version and capabilities as data packets, terminated by flush-pkt.
  const capabilities = new Map();
  let agent = "";
  let protocolVersion = 1;

  for (const chunk of chunks) {
    if (chunk.type !== "data") continue;
    const line = chunk.text.trimEnd();
    if (line.startsWith("# service=")) continue;
    if (line.startsWith("version ")) {
      protocolVersion = parseInt(line.slice("version ".length), 10);
      continue;
    }
    if (line.startsWith("agent=")) {
      agent = line.slice("agent=".length);
      continue;
    }
    // Capability line: either "name" or "name=value1,value2"
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      capabilities.set(line, []);
    } else {
      const name = line.slice(0, eqIdx);
      const values = line
        .slice(eqIdx + 1)
        .split(" ")
        .filter(Boolean);
      capabilities.set(name, values);
    }
  }

  return { capabilities, agent, protocolVersion };
}

/**
 * Execute the `ls-refs` command to list remote refs.
 *
 * @param {string} repoUrl
 * @param {object} options
 * @param {string} [options.token]
 * @param {string[]} [options.refPrefixes] — e.g. ["refs/heads/"]
 * @returns {Promise<Array<{ oid: string, refName: string, symref?: string }>>}
 */
export async function lsRefs(repoUrl, options = {}) {
  const url = `${stripDotGit(repoUrl)}.git/git-upload-pack`;
  const body = buildLsRefsRequest(options.refPrefixes || []);

  const headers = {
    "User-Agent": USER_AGENT,
    "Git-Protocol": "version=2",
    "Content-Type": "application/x-git-upload-pack-request",
    Accept: "application/x-git-upload-pack-result",
  };
  if (options.token) {
    headers.Authorization = basicAuth(options.token);
  }

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ls-refs failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  const { chunks } = parseStream(buffer);

  const refs = [];
  for (const chunk of chunks) {
    if (chunk.type !== "data") continue;
    const line = chunk.text.trimEnd();
    // Format: "<oid> <refname>[ symref-target:<target>][ peeled:<oid>]"
    const parts = line.split(" ");
    if (parts.length < 2 || parts[0].length !== 40) continue;
    const ref = { oid: parts[0], refName: parts[1] };
    for (const part of parts.slice(2)) {
      if (part.startsWith("symref-target:")) {
        ref.symref = part.slice("symref-target:".length);
      }
    }
    refs.push(ref);
  }

  return refs;
}

/**
 * Build the pkt-line encoded body for an ls-refs command.
 */
function buildLsRefsRequest(refPrefixes) {
  const pkts = [
    encode("command=ls-refs\n"),
    encode(`agent=${USER_AGENT}\n`),
    encode("object-format=sha1\n"),
    DELIM_PKT,
    encode("peel\n"),
    encode("symrefs\n"),
  ];
  for (const prefix of refPrefixes) {
    pkts.push(encode(`ref-prefix ${prefix}\n`));
  }
  pkts.push(FLUSH_PKT);
  return concat(pkts);
}
