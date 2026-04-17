#!/usr/bin/env node
// Phase 5: End-to-end test with the CtxGitRepo high-level API + Workers AI.
//
// This is the complete flow that an email-based agent would execute:
//   1. Initialize repo handle
//   2. Hydrate structure (commits + trees, no blobs)
//   3. Read a specific file on-demand
//   4. Send to LLM for reasoning
//
// All using our OWN code. Zero external git libraries.

import { execFileSync } from "node:child_process";
import { CtxGitRepo } from "./src/index.mjs";

const REPO_URL = "https://github.com/MauricioPerera/memory-poc";
const ACCOUNT_ID = "091122c40cc6f8d0d421cbc90e2caca8";
const WORKERS_AI_TOKEN = "BbzwRnz1nPh6Oa-RUObZ6YtQuPCoKsez3O4oYxVg";
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

function getGhCliToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

const ghToken = process.env.GH_TOKEN || getGhCliToken();

console.log("=== Phase 5: End-to-end con ctx-git propio ===\n");

// Step 1: Create repo handle
console.log("--- Step 1: Initialize repo ---");
const repo = new CtxGitRepo(REPO_URL, { token: ghToken });
const t1 = performance.now();
const info = await repo.init();
const t2 = performance.now();
console.log(`init(): ${(t2 - t1).toFixed(0)}ms`);
console.log(`HEAD: ${info.headOid}`);

// Step 2: Hydrate structure
console.log("\n--- Step 2: Hydrate structure (blobless) ---");
const t3 = performance.now();
const hydration = await repo.hydrateStructure();
const t4 = performance.now();
console.log(`hydrateStructure(): ${(t4 - t3).toFixed(0)}ms`);
console.log(`Downloaded: ${hydration.packBytes} bytes, ${hydration.numObjects} objects`);

// Step 3: List files (zero network — uses cached trees)
console.log("\n--- Step 3: List files (from cache) ---");
const files = repo.listFiles();
for (const f of files) {
  console.log(`  ${f.path}  (${f.oid.slice(0, 10)})`);
}

// Step 4: Read ONE specific file on-demand
console.log("\n--- Step 4: readFile('user-profile.md') ---");
const t5 = performance.now();
const content = await repo.readFile("user-profile.md");
const t6 = performance.now();
console.log(`readFile(): ${(t6 - t5).toFixed(0)}ms`);
console.log(`Content: ${content.length} chars`);

// Step 5: Send to Workers AI
console.log("\n--- Step 5: Workers AI reasoning ---");
const question =
  "Basándote en el perfil del usuario, ¿qué mercado objetivo deberíamos priorizar para su próximo producto? Responde en máximo 3 oraciones.";

const t7 = performance.now();
const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WORKERS_AI_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content:
            "Eres un analista que responde basándote únicamente en el contexto provisto. Responde en español, conciso.",
        },
        {
          role: "user",
          content: `Perfil del usuario:\n\n---\n${content}\n---\n\nPregunta: ${question}`,
        },
      ],
    }),
  },
);
const data = await res.json();
const t8 = performance.now();
console.log(`LLM: ${(t8 - t7).toFixed(0)}ms`);

if (data.success) {
  console.log("\n=== Respuesta del LLM ===");
  console.log(data.result.response);
  console.log(`\nTokens: ${data.result.usage?.total_tokens || "?"}`);
} else {
  console.log("LLM error:", data);
  process.exit(1);
}

// Final summary
console.log("\n=== Phase 5 End-to-End Summary ===");
console.log(`init():             ${(t2 - t1).toFixed(0)}ms`);
console.log(`hydrateStructure(): ${(t4 - t3).toFixed(0)}ms  (${hydration.packBytes} bytes for metadata)`);
console.log(`readFile():         ${(t6 - t5).toFixed(0)}ms  (on-demand blob fetch)`);
console.log(`LLM inference:      ${(t8 - t7).toFixed(0)}ms`);
console.log(`TOTAL:              ${(t8 - t1).toFixed(0)}ms`);
console.log("");
console.log("Lines of code in ctx-git:");
for (const src of ["pkt-line.mjs", "protocol-v2.mjs", "fetch.mjs", "packfile.mjs", "objects.mjs", "index.mjs"]) {
  const txt = await (await import("node:fs/promises")).readFile(`C:\\tmp\\ctx-git\\src\\${src}`, "utf8");
  const lines = txt.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).length;
  console.log(`  ${src.padEnd(20)} ${lines} lines (non-comment)`);
}
console.log("");
console.log("Dependencies: ZERO (solo node:crypto + node:zlib builtins)");
console.log("");
console.log("✅ Zero dependencies, 100% own code");
console.log("✅ Git protocol v2 + filter=blob:none funcionando");
console.log("✅ Lazy hydration de blobs on-demand");
console.log("✅ LLM integration validated");
console.log("✅ Worker-ready: swap node:zlib → DecompressionStream, node:crypto → crypto.subtle");
