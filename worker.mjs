// Cloudflare Worker entrypoint for ctx-git verification.
// Exposes:
//   GET /          → status + available endpoints
//   GET /refs      → ls-refs on the configured repo
//   GET /files     → list all files (requires hydrated structure)
//   GET /file?path=...&ask=...  → read file + optional LLM reasoning
//
// Env bindings (in wrangler.jsonc):
//   GH_TOKEN           — GitHub personal access token for private repo
//   REPO_URL           — git repo URL (defaults to memory-poc)
//   WORKERS_AI_TOKEN   — Workers AI API token (for /file?ask=...)
//   ACCOUNT_ID         — Cloudflare account ID (for Workers AI REST call)

import { CtxGitRepo } from "./src/index.mjs";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

/**
 * Smart agent loop:
 *   1. Read root memory.md
 *   2. LLM decides which folder/file is most relevant
 *   3. Read the chosen memory.md or file
 *   4. Repeat until we reach content, then answer the question
 *
 * This demonstrates the memory.md hierarchy pattern end-to-end.
 */
async function navigateAndAnswer(repo, question, env) {
  const trace = [];
  const maxHops = 5;
  let currentPath = "";

  for (let hop = 0; hop < maxHops; hop++) {
    // Read the current memory.md (or full tree if at leaf)
    const map = await repo.readMap({ rootPath: currentPath, maxDepth: 1 });
    trace.push({ hop, path: currentPath || "/", subfolders: map.subfolders.map((s) => s.path), files: map.files.map((f) => f.name) });

    // If no subfolders and only leaf files, let LLM pick a file to read
    const formatted = CtxGitRepo.formatMap(map);

    const hasReadContent = trace.some((t) => t.content);
    const prompt = `You are navigating an agent's memory repository. The user asked:

"${question}"

You are currently at path: ${currentPath || "/"}

Here is the structure at this level:

${formatted}

You MUST pick ONE specific file to read before you can answer. Prefer going into subfolders first if the question looks specific.

Respond with JSON only:
{
  "next": "<exact subfolder name>" | "<exact file name>",
  "reason": "short reason"
}

Rules:
- "next" MUST be a name that appears literally in the structure above
- NEVER respond with ANSWER${hasReadContent ? " unless you have already read a file and are confident" : ""}
- Prefer going deeper via subfolders for specific questions
${hasReadContent ? "" : "- You have NOT yet read any file content. Pick a file or folder to explore."}

Respond with JSON only, no prose.`;

    const llmRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WORKERS_AI_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You help navigate an agent memory tree. Respond with JSON only." },
            { role: "user", content: prompt },
          ],
        }),
      },
    );
    const llmData = await llmRes.json();
    const rawResponse = llmData.result?.response || "";

    // Try to parse JSON from response
    let decision;
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      decision = JSON.parse(jsonMatch ? jsonMatch[0] : rawResponse);
    } catch {
      decision = { next: "ANSWER", reason: "parse failed, attempting to answer" };
    }

    trace[trace.length - 1].decision = decision;

    // Block premature ANSWER — force the LLM to at least read one file
    if (decision.next === "ANSWER" && !trace.some((t) => t.content)) {
      // Force reading the first file at this level (LLM gave up early)
      if (map.files.length > 0) {
        decision.next = map.files[0].name;
        decision.reason = "forced: LLM tried to answer without reading content";
      }
    }

    if (decision.next === "ANSWER" || !decision.next) {
      // Answer with accumulated context
      const contextFile = trace.find((t) => t.content)?.content || "";
      const answerPrompt = `Based on the navigation and any content you've seen, answer: "${question}"`;

      const ansRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/${MODEL}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.WORKERS_AI_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "Answer based on the context provided. Be concise. Spanish." },
              {
                role: "user",
                content: `${answerPrompt}\n\nContext:\n${contextFile}`,
              },
            ],
          }),
        },
      );
      const ans = await ansRes.json();
      return { answer: ans.result?.response, trace };
    }

    // Check if decision points to a file or folder
    const subfolderMatch = map.subfolders.find(
      (s) => s.path === decision.next || s.path.endsWith("/" + decision.next) || s.path.split("/").pop() === decision.next,
    );
    let fileMatch = map.files.find((f) => f.name === decision.next);

    // Fuzzy match: if LLM picked a filename that's not at this level,
    // search recursively through the known tree structure
    if (!fileMatch && !subfolderMatch && !decision.next.includes("/")) {
      const fullMap = await repo.readMap({ rootPath: currentPath, maxDepth: 5 });
      fileMatch = findFileRecursive(fullMap, decision.next);
    }

    if (fileMatch) {
      const content = await repo.readFile(fileMatch.path);
      trace[trace.length - 1].content = content;
      // Now answer with this content
      const ansRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/${MODEL}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.WORKERS_AI_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "Answer based only on the provided file content. Concise. Spanish." },
              {
                role: "user",
                content: `Question: ${question}\n\nFile: ${fileMatch.path}\n\n---\n${content}\n---`,
              },
            ],
          }),
        },
      );
      const ans = await ansRes.json();
      return { answer: ans.result?.response, file: fileMatch.path, trace };
    } else if (subfolderMatch) {
      currentPath = subfolderMatch.path;
    } else {
      return { error: "LLM returned invalid next step", decision, trace };
    }
  }

  return { error: "max hops reached", trace };
}

function findFileRecursive(mapNode, filename) {
  for (const f of mapNode.files) {
    if (f.name === filename) return f;
  }
  for (const sub of mapNode.subfolders) {
    const found = findFileRecursive(sub, filename);
    if (found) return found;
  }
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const repoUrl = env.REPO_URL || "https://github.com/MauricioPerera/memory-poc";

    try {
      if (url.pathname === "/") {
        return json({
          service: "ctx-git-worker",
          repo: repoUrl,
          endpoints: {
            "GET /refs": "List remote refs via git protocol v2",
            "GET /files": "Walk tree and list all files (blobless)",
            "GET /file?path=...": "Read a specific file on-demand",
            "GET /file?path=...&ask=...": "Read + send to LLM",
            "POST /file?path=...": "Write a file (body = content, header X-Commit-Message)",
          },
          runtime: {
            userAgent: request.headers.get("User-Agent"),
            cf: request.cf?.colo || "local",
          },
        });
      }

      if (url.pathname === "/refs") {
        const repo = new CtxGitRepo(repoUrl, { token: env.GH_TOKEN });
        const t1 = Date.now();
        const info = await repo.init();
        const t2 = Date.now();
        return json({
          headOid: info.headOid,
          capabilities: info.caps,
          time_ms: t2 - t1,
        });
      }

      if (url.pathname === "/ask") {
        const question = url.searchParams.get("q");
        if (!question) return json({ error: "missing q param" }, 400);

        const repo = new CtxGitRepo(repoUrl, { token: env.GH_TOKEN });
        const t1 = Date.now();
        const result = await navigateAndAnswer(repo, question, env);
        const t2 = Date.now();

        return json({ question, ...result, total_ms: t2 - t1 });
      }

      if (url.pathname === "/map") {
        const rootPath = url.searchParams.get("path") || "";
        const maxDepth = parseInt(url.searchParams.get("depth") || "3", 10);
        const format = url.searchParams.get("format") || "json";

        const repo = new CtxGitRepo(repoUrl, { token: env.GH_TOKEN });
        const t1 = Date.now();
        const map = await repo.readMap({ rootPath, maxDepth });
        const t2 = Date.now();

        if (format === "text" || format === "markdown") {
          return new Response(CtxGitRepo.formatMap(map), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        return json({ map, time_ms: t2 - t1 });
      }

      if (url.pathname === "/files") {
        const repo = new CtxGitRepo(repoUrl, { token: env.GH_TOKEN });
        const t1 = Date.now();
        await repo.init();
        const t2 = Date.now();
        const hydration = await repo.hydrateStructure();
        const t3 = Date.now();
        const files = repo.listFiles();
        return json({
          files,
          timings: {
            init_ms: t2 - t1,
            hydrate_ms: t3 - t2,
          },
          pack_bytes: hydration.packBytes,
          object_count: hydration.numObjects,
        });
      }

      if (url.pathname === "/file" && request.method === "POST") {
        const path = url.searchParams.get("path");
        if (!path) return json({ error: "missing path param" }, 400);

        const content = await request.text();
        if (!content) return json({ error: "empty body" }, 400);

        const message =
          request.headers.get("X-Commit-Message") || `ctx-git write: ${path}`;
        const authorName = request.headers.get("X-Author-Name") || "ctx-git-worker";
        const authorEmail =
          request.headers.get("X-Author-Email") || "worker@ctx-git.local";

        const repo = new CtxGitRepo(repoUrl, { token: env.GH_TOKEN });
        const result = await repo.writeFile(path, content, {
          message,
          author: { name: authorName, email: authorEmail },
        });

        return json(result, result.ok ? 200 : 500);
      }

      if (url.pathname === "/file") {
        const path = url.searchParams.get("path");
        if (!path) return json({ error: "missing path param" }, 400);

        const ask = url.searchParams.get("ask");

        const repo = new CtxGitRepo(repoUrl, { token: env.GH_TOKEN });
        const t1 = Date.now();
        const content = await repo.readFile(path);
        const t2 = Date.now();

        const result = {
          path,
          oid: repo.findBlobOid(path),
          content,
          content_length: content.length,
          timings: { read_ms: t2 - t1 },
        };

        if (ask && env.WORKERS_AI_TOKEN && env.ACCOUNT_ID) {
          const t3 = Date.now();
          const llmRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/${MODEL}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${env.WORKERS_AI_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messages: [
                  {
                    role: "system",
                    content:
                      "Responde basándote ÚNICAMENTE en el contexto provisto. Español, conciso.",
                  },
                  {
                    role: "user",
                    content: `Contexto:\n\n---\n${content}\n---\n\nPregunta: ${ask}`,
                  },
                ],
              }),
            },
          );
          const llmData = await llmRes.json();
          const t4 = Date.now();
          result.llm = {
            answer: llmData.result?.response,
            usage: llmData.result?.usage,
            llm_ms: t4 - t3,
          };
        }

        return json(result);
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json(
        {
          error: e.message,
          stack: e.stack,
        },
        500,
      );
    }
  },
};
