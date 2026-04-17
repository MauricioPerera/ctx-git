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
