# Plan‑Act Agent Runbook

## Purpose
This runbook centers on the Plan‑and‑Act agent that is the current focus of development. It explains how the agent pipeline works, how to run it locally, how to configure providers/models, and how it relates to the existing OpenAI‑compatible REST API.

## Repository Overview
- `packages/agents` — Core agents and provider plumbing.
  - Plan‑Act agent: `packages/agents/src/agents/plan-act.agent.ts`
  - Chat Completions agent: `packages/agents/src/agent.ts`
  - Multi‑provider model registry for Plan‑Act: `packages/agents/src/models/index.ts`
  - OpenAI‑compatible provider for Chat agent: `packages/agents/src/provider.ts`
- `packages/tools` — Tool registry returned to agents. Add AI SDK tools here and pass them to the Plan/Act phases.
- `packages/logger` — Structured logger with NestJS adapter.
- `apps/api` — NestJS app exposing OpenAI‑compatible endpoints with SSE, currently wired to the Chat Completions agent.
  - Chat completions controller: `apps/api/src/modules/chat/completions/completions.controller.ts`
  - Models controller: `apps/api/src/modules/models/model.controller.ts`
  - Module wiring: `apps/api/src/modules/app.module.ts`
  - Bootstrap: `apps/api/src/main.ts`

## Plan‑Act Agent

The Plan‑Act agent orchestrates three phases over a single conversation turn:
- Plan: produce a small, structured plan the agent can act against.
- Act: iterate through plan steps, optionally adding new steps on the fly, and gather observations (tool calls can be wired here).
- Respond: craft the final user‑facing answer using the most recent user message, the plan, and the collected actions/observations.

Implementation: `packages/agents/src/agents/plan-act.agent.ts:1`

Key pieces:
- Config (`PlanActAgentConfig`):
  - `instructions?: string` — system behavior
  - `model?: string | LanguageModel` — model identifier or pre‑constructed model
  - `plan?: { steps?: number; tools?: ToolSet }`
  - `act?: { steps?: number; tools?: ToolSet }`
- Defaults: 5 plan steps, 5 act steps, and no tools unless provided.
- Model resolution: `packages/agents/src/models/index.ts:1` resolves `<provider>:<model>` via the AI SDK registry and provider‑specific API keys.

Streaming shape:
- `run(input: ModelMessage[])` returns an async generator that yields chunks from:
  1) plan streaming, 2) act streaming, then 3) final response streaming.
- During plan/act, partial outputs are parsed incrementally; valid plans and actions are retained and used downstream.

Using tools:
- Provide separate toolsets for Plan vs Act via `plan.tools` and `act.tools`. For example, planning tools might search or retrieve docs, while act tools perform concrete operations.
- Define tools under `packages/tools/src/index.ts:1` and pass them into the agent.

### Quick Start (Plan‑Act)
1) Configure a provider API key (see Environment) and pick a model.
2) Write a small script to run the agent:

```ts
// scripts/plan-act-demo.ts
import { PlanActAgent } from '@packages/agents/agents';
import type { ModelMessage, ToolSet } from 'ai';

const planTools: ToolSet = {};
const actTools: ToolSet = {};

const agent = new PlanActAgent({
  instructions: 'You are a helpful Plan-and-Act agent.',
  // Either a string like 'openai:gpt-4o-mini' or omit to use the first configured provider's default
  model: 'openai:gpt-4o-mini',
  plan: { steps: 4, tools: planTools },
  act: { steps: 6, tools: actTools }
});

const messages: ModelMessage[] = [
  { role: 'user', content: 'Find three recent TypeScript tips and summarize them.' }
];

async function main() {
  for await (const chunk of agent.run(messages)) {
    // Each chunk is an Agent streaming step (plan → act → final response)
    // For a simple demo, just log the chunk object:
    console.log(chunk);
  }
}

void main();
```

Run with:
```bash
pnpm ts-node scripts/plan-act-demo.ts
```

Tip: Instead of logging raw chunks, inspect `chunk.type`/`chunk.textDelta` (per AI SDK) to render deltas nicely.

## OpenAI‑Compatible API (Now uses Plan‑Act)

The Nest API exposes OpenAI‑compatible routes and now routes `/v1/chat/completions` to the Plan‑Act agent by default. You can also opt into the legacy chat agent per‑request via an `agent` field.

Routes:
- `POST /v1/chat/completions` — Non-streaming and SSE streaming (`stream=true`). Controller: `apps/api/src/modules/chat/completions/completions.controller.ts:1`
- `GET /v1/models`, `GET /v1/models/:id` — Minimal model objects (including a virtual `plan-act` model so UI clients can target the Plan-Act agent). Controller: `apps/api/src/modules/models/model.controller.ts:1`
- `GET /v1/health` — Simple health check that returns `{ status, uptime, timestamp }`. Controller: `apps/api/src/modules/health/health.controller.ts:1`

Wiring:
- App module wires `CHAT_AGENT_TOKEN` to a router that selects Plan-Act by default: `apps/api/src/modules/app.module.ts:1`
- The router lives in `packages/agents/src/router.ts:1` and supports `agent: 'plan-act' | 'chat'`.
- Global `Authorization: Bearer …` guard and an OpenAI-style error filter are installed in `apps/api/src/main.ts:1` and `apps/api/src/filters/openai-error.filter.ts:1`.
- The auth guard allows unauthenticated access to `/v1/health` and to `OPTIONS` preflight requests so browser clients (Open WebUI, etc.) can probe endpoints successfully.
- Unknown endpoints (404) are logged after response via middleware in `apps/api/src/main.ts`.
- CORS is enabled for `GET`, `POST`, and `OPTIONS`, letting browser clients issue preflight requests to `/v1/models` and `/v1/chat/completions` without extra wiring.

Example requests (Plan‑Act default):
- Non‑streaming
```bash
curl -sS http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test-token' \
  -d '{ "messages": [{ "role": "user", "content": "Say hello" }] }'
```
- Streaming (SSE)
```bash
curl -N http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test-token' \
  -d '{ "stream": true, "messages": [{ "role": "user", "content": "Give me a haiku" }] }'
```

Select agent explicitly:
- Force Plan‑Act (default): add `"agent": "plan-act"`
- Use legacy Chat Completions: add `"agent": "chat"`

```bash
curl -sS http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test-token' \
  -d '{
        "agent": "plan-act",
        "model": "openai:gpt-4o-mini",
        "messages": [{ "role": "user", "content": "What is the capital of Japan?" }]
      }'
```

## Environment

Environment files are read automatically on startup (`packages/agents/src/env.ts:1`). Override the env file path with `ENV_FILE`.

Plan‑Act (multi‑provider registry used by `/v1/chat/completions` by default):
- Set one or more provider‑specific keys; the first configured provider becomes the default if no model is supplied.
  - `AI_OPENAI_API_KEY`
  - `AI_ANTHROPIC_API_KEY`
  - `AI_GOOGLE_API_KEY`
  - `AI_GROQ_API_KEY`
  - `AI_DEEPINFRA_API_KEY`
  - `AI_XAI_API_KEY`
- Model format: `<provider>:<model>` (e.g., `openai:gpt-4o-mini`).
- Default models if only a provider key is set and no model is provided:
  - openai → `gpt-5-mini`
  - anthropic → `claude-sonnet-4-5`
  - google → `gemini-2.5-flash`
  - groq → `openai/gpt-oss-120b`
  - deepinfra → `zai-org/GLM-4.6`
  - xai → `grok-4-fast-reasoning`

Legacy Chat Completions (optional when `agent: "chat"`):
- `PROVIDER_API_KEY` — API key for the OpenAI‑compatible endpoint
- `PROVIDER_BASE_URL` — Base URL (defaults to `https://api.openai.com/v1`)
- `MODEL` — Default model id for Chat Completions
- `PORT` — API port (default `3000`)

Node/Tooling:
- Node.js 18.18+ and pnpm 10.x are recommended (repo uses `packageManager: pnpm@10.17.0`).

## Local Development

Install deps:
```bash
pnpm install
```

Build + run API once:
```bash
pnpm --filter @apps/api build
pnpm --filter @apps/api exec node dist/main.js
```

Iterate on API:
```bash
# Terminal A: rebuild on change
pnpm --filter @packages/agents dev & pnpm --filter @apps/api dev

# Terminal B: run compiled server
pnpm --filter @apps/api exec node dist/main.js
```

Run a Plan‑Act script:
```bash
pnpm ts-node scripts/plan-act-demo.ts
```

## Extending
- Tools: add AI SDK tools in `packages/tools/src/index.ts:1` and pass them to `plan.tools`/`act.tools` when constructing `PlanActAgent`.
- Behavior: tweak planning/action step budgets and instructions in `plan-act.agent.ts`.
- API: to expose Plan‑Act via HTTP, create a new controller/service that wraps `PlanActAgent` or add an adapter that implements the `ChatAgent` interface if you want it behind `/v1/chat/completions`.

## Automated Tasks
- Lint: `pnpm lint`
- Test: `pnpm test`
- Clean: `pnpm clean`

## Troubleshooting
- Plan‑Act “Provider not configured”: ensure the corresponding `AI_*_API_KEY` is set.
- Plan‑Act “Unknown model”: provide `<provider>:<model>` or set a supported provider key to use its default.
- API 401: include `Authorization: Bearer <token>` (any non‑empty token passes the guard).
- Streaming stalls: use `curl -N`, ensure proxies do not buffer SSE (`X-Accel-Buffering: no`).

This runbook tracks the Plan‑Act agent as the primary development surface while keeping the Chat Completions API documented for compatibility.
