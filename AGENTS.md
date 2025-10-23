# Agents Overview

This repository hosts a Turbo + pnpm monorepo for building AI agents on top of NestJS and the Vercel AI SDK v5. Use this document as a quick reference when reasoning about agent behavior or editing related code.

## Key Packages

- **`packages/agents`** — Defines agent composition, validation schemas, and provider plumbing. Entry point is `packages/agents/src/agent.ts` where `createChatAgent` validates OpenAI-compatible payloads, streams text with `streamText`, and maps usage details. Provider configuration lives in `packages/agents/src/provider.ts`.
- **`packages/tools`** — Placeholder tool registry returning an `ai` SDK `ToolSet`. Extend `defaultToolset` in `packages/tools/src/index.ts` with real tool implementations (zod schemas + execute handlers).
- **`packages/logger`** — Shared logger with colorized output and NestJS adapter (`createLogger`, `NestLogger`). Used by the API bootstrap.

## API Application

- **`apps/api`** provides OpenAI-compatible routes:
  - `POST /v1/chat/completions` — Accepts `{ model?, messages, temperature?, stream? }`.
    - Non-streaming: returns `chat.completion` with `choices[0].message` and optional `usage`.
    - Streaming: `stream=true` returns SSE with `chat.completion.chunk` events and final `[DONE]`.
  - `GET /v1/health` — Basic healthcheck returning `{ status, uptime, timestamp }`. This route is public (no auth) to support client probes.
  - `GET /v1/models` and `GET /v1/models/:id` — Minimal model objects `{ id, object:"model", created, owned_by }`.
    - Response always includes a virtual `plan-act` model so UI clients (e.g., Open WebUI) can pick it; selecting it routes `POST /v1/chat/completions` through the Plan‑Act agent automatically.
  - Controller: `apps/api/src/modules/chat/completions/completions.controller.ts` — Validates with `nestjs-zod`, invokes the configured agent, shapes OpenAI responses, and handles SSE.
  - Module wiring: `apps/api/src/modules/app.module.ts` — Registers the chat agent factory (`CHAT_AGENT_TOKEN`) and a global auth guard enforcing `Authorization: Bearer ...`.
  - Bootstrap: `apps/api/src/main.ts` — Starts Nest, attaches shared logger, installs a global OpenAI-style error filter, listens on `PORT` (default 3000).
    - Global CORS is enabled (`GET`, `POST`, `OPTIONS`) so browser clients can preflight `/v1/models` and `/v1/chat/completions`.
  - Unknown endpoints (404) are logged in `apps/api/src/main.ts` so you can see clients probing non-existent routes.

By default, `/v1/chat/completions` uses a router that selects the Plan‑Act agent. You can override per request with an `agent` field (`"plan-act" | "chat"`).

## Environment Variables

Set these in the project root `.env`:

- `PROVIDER_API_KEY` — API key for the OpenAI-compatible backend.
- `PROVIDER_BASE_URL` — Base URL of the provider (defaults to `https://api.openai.com/v1`).
- `MODEL` — Default model identifier (defaults to `gpt-4.1-mini`).
- `PORT` — API port (defaults to `3000`).

## Agent Contract

`createChatAgent` and the router expect payloads shaped like OpenAI Chat Completions, with an optional `agent` selector:

```ts
{
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  temperature?: number;
  stream?: boolean; // used by API layer for SSE
  agent?: 'plan-act' | 'chat';
}
```

It returns objects with `id`, `created`, `model`, `text`, `finishReason`, optional `usage`, and `steps` mirroring `streamText` output. The agent also exposes a `.stream(input)` method that returns the raw `streamText` result for SSE.

## Extending Agents

1. **Add tools** in `packages/tools/src/index.ts` using `tool({...})` helpers from `ai`. Export them via `defaultToolset`.
2. **Compose behavior** in `packages/agents/src/agent.ts` — adjust parsing, add system prompts, tool-choice strategies, or handle streaming callbacks.
3. **Expose additional endpoints** in `apps/api`, injecting the shared agent or creating new Nest providers per use case.
4. **Logging & telemetry** — reuse `packages/logger` or plug in distributed tracing as needed.

Keep this file updated when adding new agents, tools, or endpoints so automation and LLMs can rely on current context.

User notes:
- When testing don't overwrite the model being used unless it is a recent or new model that is low cost such as gpt-5-mini, kimi k2, claude-haiku-4-5, grok-code-fast-1, grok-4-fast-reasoning, grok-4-fast-non-reasoning. This is to avoid getting upcharged for lower quality legacy models. I prefer the model I have specified in the .env the most.
- Never ever commit changes. Never undo previous commits. Never `git reset`. I will manage the repo myself do not touch any of my git stuff.