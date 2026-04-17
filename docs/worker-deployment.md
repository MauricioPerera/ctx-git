# Deploying ctx-git in Cloudflare Workers

Step-by-step guide for using ctx-git inside a Cloudflare Worker.

## Prerequisites

- Cloudflare account
- `wrangler` CLI installed (`npm install -g wrangler` or `npx wrangler`)
- A git repo to work with (any host that supports HTTPS + protocol v2)

## 1. Create the Worker project

```bash
mkdir my-agent-worker
cd my-agent-worker
npm init -y
npm install ctx-git
```

Mark the package as ESM:

```json
// package.json
{
  "type": "module"
}
```

## 2. Configure wrangler

Create `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-agent-worker",
  "main": "worker.mjs",
  "compatibility_date": "2026-04-16",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "REPO_URL": "https://github.com/yourname/your-memory-repo"
  }
}
```

The **`nodejs_compat` flag is required** — ctx-git uses `node:zlib` for packfile decompression.

## 3. Write the Worker

Create `worker.mjs`:

```javascript
import { CtxGitRepo } from "ctx-git";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const repo = new CtxGitRepo(env.REPO_URL, { token: env.GH_TOKEN });

    try {
      // Read a file by path
      if (url.pathname === "/memory" && request.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) {
          return new Response("missing ?path=...", { status: 400 });
        }
        const content = await repo.readFile(path);
        return new Response(content, {
          headers: { "Content-Type": "text/markdown" },
        });
      }

      // Write a file
      if (url.pathname === "/memory" && request.method === "POST") {
        const path = url.searchParams.get("path");
        const content = await request.text();
        const result = await repo.writeFile(path, content, {
          message: request.headers.get("X-Commit-Message") || `write ${path}`,
          author: {
            name: request.headers.get("X-Author-Name") || "worker",
            email: request.headers.get("X-Author-Email") || "worker@example.com",
          },
        });
        return new Response(JSON.stringify(result, null, 2), {
          status: result.ok ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Navigate memory hierarchy
      if (url.pathname === "/map") {
        const rootPath = url.searchParams.get("path") || "";
        const depth = parseInt(url.searchParams.get("depth") || "3", 10);
        const map = await repo.readMap({ rootPath, maxDepth: depth });
        const format = url.searchParams.get("format");
        if (format === "text") {
          return new Response(CtxGitRepo.formatMap(map), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        return new Response(JSON.stringify(map, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message, stack: e.stack }, null, 2),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
```

## 4. Set secrets

Create a Personal Access Token on GitHub (or equivalent on your git host) with `repo` permission.

### Local dev

Create `.dev.vars`:

```
GH_TOKEN=ghp_your_token_here
```

Add to `.gitignore`:

```
.dev.vars
```

### Production

```bash
echo -n "ghp_your_token_here" | npx wrangler secret put GH_TOKEN
```

## 5. Test locally

```bash
npx wrangler dev --port 8787
```

In another terminal:

```bash
# Read a file
curl "http://127.0.0.1:8787/memory?path=README.md"

# Write a file
curl -X POST "http://127.0.0.1:8787/memory?path=test.md" \
  -H "Content-Type: text/markdown" \
  -H "X-Commit-Message: test write from worker" \
  --data-binary "# Hello from Worker"

# Navigate memory
curl "http://127.0.0.1:8787/map?format=text"
```

## 6. Deploy

```bash
npx wrangler deploy
```

Wrangler outputs the deployed URL:

```
Deployed my-agent-worker triggers (1.2 sec)
  https://my-agent-worker.yoursubdomain.workers.dev
```

Test the deployed version:

```bash
BASE="https://my-agent-worker.yoursubdomain.workers.dev"
curl "$BASE/memory?path=README.md"
```

## Common patterns

### Integrating with Workers AI

```javascript
import { CtxGitRepo } from "ctx-git";

export default {
  async fetch(request, env) {
    const question = new URL(request.url).searchParams.get("q");
    const repo = new CtxGitRepo(env.REPO_URL, { token: env.GH_TOKEN });

    // 1. Get the memory map
    const map = await repo.readMap({ maxDepth: 2 });
    const mapText = CtxGitRepo.formatMap(map);

    // 2. Ask the LLM which file to read
    const routingResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
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
              content: "Given a memory map and a question, respond with the file path most relevant. JSON only: { path: \"...\" }",
            },
            {
              role: "user",
              content: `Map:\n${mapText}\n\nQuestion: ${question}`,
            },
          ],
        }),
      },
    );
    const routing = await routingResponse.json();
    const path = JSON.parse(routing.result.response).path;

    // 3. Read the file
    const content = await repo.readFile(path);

    // 4. Ask the LLM to answer based on content
    const answerResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WORKERS_AI_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "Answer based only on the file content provided. Be concise." },
            { role: "user", content: `Question: ${question}\n\nFile: ${path}\n\n---\n${content}` },
          ],
        }),
      },
    );
    const answer = await answerResponse.json();

    return new Response(answer.result.response, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
```

### Per-user memory repos

Give each user their own repo URL. Store it in D1 or KV:

```javascript
const userRepoUrl = await env.USER_REPOS.get(userId);
const userToken = await env.USER_TOKENS.get(userId);

const repo = new CtxGitRepo(userRepoUrl, { token: userToken });
```

### Email Routing integration

Hook your Worker up to Cloudflare Email Routing:

```javascript
export default {
  async email(message, env) {
    // Extract sender to find their repo
    const userRepoUrl = await lookupRepoForEmail(message.from, env);
    const repo = new CtxGitRepo(userRepoUrl, { token: env.GH_TOKEN });

    // Read user profile + relevant memory
    const map = await repo.readMap({ maxDepth: 1 });
    const profile = await repo.readFile("profile/memory.md");
    const rawText = await message.raw.text();

    // ... process with LLM, write reply
  },
};
```

See [Cloudflare Email Routing docs](https://developers.cloudflare.com/email-routing/email-workers/) for the full `email()` handler signature.

## Troubleshooting

### `Error: Server does not support filter`

Your git server doesn't support `filter=blob:none` in protocol v2. This is required by ctx-git for lazy hydration.

Supported:
- GitHub
- GitLab (recent versions)
- Gitea (recent versions)
- Cloudflare Artifacts

Not supported (or partial):
- Very old git servers
- Some corporate git proxies

### `ERR_TRAILING_JUNK_AFTER_STREAM_END`

This happens when running in pure browser/Worker context without `nodejs_compat`. Currently ctx-git requires `node:zlib` for reliable packfile parsing.

Fix: add `"compatibility_flags": ["nodejs_compat"]` to `wrangler.jsonc`.

### `401 Unauthorized`

Your `GH_TOKEN` is missing or invalid.

- Check it's set: `npx wrangler secret list`
- For local dev: check `.dev.vars` exists and has `GH_TOKEN=...`
- Token needs `repo` scope on GitHub (or equivalent on your host)

### `fetch failed: 403 Forbidden`

The token doesn't have access to the repo. For private repos on GitHub, the token owner needs collaborator access.

### Bundle size warnings

ctx-git is ~30 KiB. That's small. If your Worker is hitting size limits, the issue is elsewhere.

### Rate limits

GitHub REST API limits don't apply — we use the git protocol directly, which has its own separate rate limits (much higher for repo operations).

For heavy usage at scale, consider Cloudflare Artifacts (when publicly available) — 720K requests/hour/namespace vs GitHub's 5K/hour/token.

## Security considerations

- Never commit `.dev.vars` or secrets
- Rotate `GH_TOKEN` periodically
- For production multi-user setups, use **per-user tokens**, not a single shared one
- Consider [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) to put auth in front of your Worker
- Reading files exposes their content — apply your own authorization logic before calling `readFile`
