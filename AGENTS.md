# Agents Overview

This repository hosts a Turbo + pnpm monorepo for building AI agents on top of NestJS and the Vercel AI SDK v5. Use this document as a quick reference when reasoning about agent behavior or editing related code.

## Key Packages

- **`packages/agents`** — Defines agent composition, validation schemas, and provider plumbing. Entry point is `packages/agents/src/agent.ts` where `createChatAgent` validates OpenAI-compatible payloads, streams text with `streamText`, and maps usage details. Provider configuration lives in `packages/agents/src/provider.ts`.
- **`packages/tools`** — Placeholder tool registry returning an `ai` SDK `ToolSet`. Extend `defaultToolset` in `packages/tools/src/index.ts` with real tool implementations (zod schemas + execute handlers).
- **`packages/logger`** — Shared logger with colorized output and NestJS adapter (`createLogger`, `NestLogger`). Used by the API bootstrap.

## API Application

- **`apps/api`** exposes an OpenAI chat-completions compatible endpoint at `POST /v1/chat/completions`.
  - Controller: `apps/api/src/modules/app.controller.ts` — Validates requests with `nestjs-zod`, invokes the chat agent, and returns OpenAI-shaped responses (including `_debug.steps`).
  - Module wiring: `apps/api/src/modules/app.module.ts` — Registers the chat agent factory (`CHAT_AGENT_TOKEN`).
  - Bootstrap: `apps/api/src/main.ts` — Starts Nest, attaches shared logger, listens on `PORT` (default 3000).

## Environment Variables

Set these in the project root `.env`:

- `PROVIDER_API_KEY` — API key for the OpenAI-compatible backend.
- `PROVIDER_BASE_URL` — Base URL of the provider (defaults to `https://api.openai.com/v1`).
- `MODEL` — Default model identifier (defaults to `gpt-4.1-mini`).
- `PORT` — API port (defaults to `3000`).

## Agent Contract

`createChatAgent` expects payloads shaped like OpenAI Chat Completions:

```ts
{
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  temperature?: number;
}
```

It returns objects with `id`, `created`, `model`, `text`, `finishReason`, optional `usage`, and `steps` mirroring `streamText` output.

## Extending Agents

1. **Add tools** in `packages/tools/src/index.ts` using `tool({...})` helpers from `ai`. Export them via `defaultToolset`.
2. **Compose behavior** in `packages/agents/src/agent.ts` — adjust parsing, add system prompts, tool-choice strategies, or handle streaming callbacks.
3. **Expose additional endpoints** in `apps/api`, injecting the shared agent or creating new Nest providers per use case.
4. **Logging & telemetry** — reuse `packages/logger` or plug in distributed tracing as needed.

Keep this file updated when adding new agents, tools, or endpoints so automation and LLMs can rely on current context.
