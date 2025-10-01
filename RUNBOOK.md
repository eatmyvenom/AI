# AI Agents Runbook

## Purpose
This runbook explains how to set up, run, and exercise the Turbo + pnpm monorepo that powers the NestJS API and chat agent layer. Share it with teammates who need to verify builds, run local smoke tests, or extend the agent stack.

## System Overview
- **apps/api** – NestJS application exposing OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/models`). Wires the shared chat agent and enforces bearer auth.
- **packages/agents** – Validates OpenAI-style chat payloads, calls `streamText` from the Vercel AI SDK, and normalizes responses/usage.
- **packages/tools** – Tool registry returned to the agent. Ships empty; populate `defaultToolset` to enable tool calls.
- **packages/logger** – Structured logger with NestJS adapter. Used during bootstrap for colorized console output.

A request lifecycle looks like: HTTP request → Auth guard (`Authorization: Bearer …`) → Controller validation via `ChatCompletionSchema` → Agent execution (`createChatAgent`) → Provider call (`createOpenAICompatible`) → Response mapping / SSE streaming.

## Prerequisites
- Node.js 18.18+ (NestJS 11 requires Node 18 or 20).
- pnpm 10 (workspace uses `packageManager: pnpm@10.17.0`).
- Access to an OpenAI-compatible provider and API key.

Verify versions:
```bash
node -v
pnpm -v
```

## Initial Setup
1. Install dependencies at the repo root:
   ```bash
   pnpm install
   ```
2. Create `.env` in the repo root (same folder as `package.json`):
   ```dotenv
   PROVIDER_API_KEY=sk-...
   PROVIDER_BASE_URL=https://api.openai.com/v1   # optional override
   MODEL=gpt-4.1-mini                           # optional override
   PORT=3000                                    # optional override
   ```
3. (Optional) Generate environment-specific overrides by exporting vars in your shell instead of using `.env` during CI/CD.

## Building & Running Locally
### One-time compile + run
```bash
pnpm --filter @apps/api build
pnpm --filter @apps/api exec node dist/main.js
```
This compiles TypeScript under `apps/api/src` to `apps/api/dist` and starts the HTTP server on `PORT` (default 3000).

### Iterative development workflow
1. Terminal A – TypeScript watch (auto rebuild to `dist/`):
   ```bash
   pnpm --filter @apps/api dev
   ```
2. Terminal B – Run the compiled server (restart after each rebuild or pair with a process manager like `nodemon`):
   ```bash
   pnpm --filter @apps/api exec node dist/main.js
   ```
Logs are emitted through `packages/logger` with timestamped, colorized entries.

## Testing the API
All requests must include `Authorization: Bearer <token>`; the guard only checks that a non-empty token exists.

### Health check (models list)
```bash
curl -sS http://localhost:3000/v1/models \
  -H "Authorization: Bearer test-token" | jq
```
Expected output: single model derived from `MODEL` env var.

### Non-streaming chat completion
```bash
curl -sS http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{
        "model": "gpt-4.1-mini",
        "messages": [{ "role": "user", "content": "Say hello" }]
      }'
```
On success, returns an OpenAI-compatible payload with `choices[0].message.content` and optional `usage` if the upstream provider supplies token counts.

### Streaming chat completion (SSE)
```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token" \
  -d '{
        "stream": true,
        "messages": [{ "role": "user", "content": "Give me a haiku" }]
      }'
```
Expect a sequence of `data: {"object":"chat.completion.chunk",...}` events followed by `data: [DONE]`. If the underlying provider errors, the final chunk has `finish_reason: "error"`.

### Negative-path checks
- Missing `Authorization` header → `401` with OpenAI-style error body.
- Schema violations (e.g., empty messages array) → `400` with validation message from `nestjs-zod`.
- Provider/network failures bubble up as `500` with `type: "server_error"` unless mapped to a known HTTP code.

## Automated Tasks
- Lint: `pnpm lint` (delegates to Turbo across packages).
- Tests: `pnpm test` (currently prints "No tests yet" in `apps/api`).
- Clean build artifacts: `pnpm clean`.

## Extending the System
- **Tools:** Implement AI SDK tools in `packages/tools/src/index.ts` and expose them via `defaultToolset`. The Nest provider injects whatever `getActiveTools()` returns.
- **Agent behaviour:** Adjust `packages/agents/src/agent.ts` for prompts, tool routing, or usage mapping. Additional agent pipelines (e.g., plan-act) live under `packages/agents/src/agents`.
- **API surface:** Add new Nest controllers/modules under `apps/api/src/modules`, injecting the existing `CHAT_AGENT_TOKEN` or defining new providers as needed.

## Deployment Notes
- Build the API with `pnpm --filter @apps/api build`; deploy artifacts under `apps/api/dist`.
- Ensure environment variables (`PROVIDER_API_KEY`, `PROVIDER_BASE_URL`, `MODEL`, `PORT`) are supplied in the target environment.
- For process supervision, wrap `node dist/main.js` with your platform's process manager (PM2, systemd, etc.).
- Logs are stdout/stderr compatible; aggregate them with your platform's log collection (e.g., CloudWatch, Datadog).

## Troubleshooting
- **401 Unauthorized:** Verify the request includes `Authorization: Bearer <token>`; the value can be any non-empty token.
- **Provider 401/403:** Double-check `PROVIDER_API_KEY` and that the provider accepts the chosen `MODEL`.
- **Validation errors:** Inspect the JSON in the error response – it echoes Zod validation messages for each issue.
- **Hanging streaming requests:** Confirm the client keeps the connection open (`curl -N`) and that no corporate proxy strips SSE headers (`X-Accel-Buffering: no`).

Share this runbook with anyone onboarding to the project or performing manual smoke tests after deployments.
