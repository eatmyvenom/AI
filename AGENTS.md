# Agents Overview

This repository hosts a Turbo + pnpm monorepo for building AI agents on top of NestJS and the Vercel AI SDK v5. Use this document as a quick reference when reasoning about agent behavior or editing related code.

## Key Packages

- **`packages/agents`** — Defines agent composition, validation schemas, and provider plumbing. Entry point is `packages/agents/src/agent.ts` where `createChatAgent` validates OpenAI-compatible payloads, streams text with `streamText`, and maps usage details. Provider configuration lives in `packages/agents/src/provider.ts`.
- **`packages/tools`** — Server-managed tool registry returning an `ai` SDK `ToolSet`. Extend `defaultToolset` in `packages/tools/src/index.ts` with server-executed tools or MCP connectors (zod schemas + execute handlers).
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

## Tool Execution

All tool invocations happen on the server or through configured MCP servers so API clients never supply executable code. The built-in toolset lives in `packages/tools/src/index.ts` (`calculator`, `getCurrentTime`, `generateUUID`, `addPlanSteps`) and can be filtered per request with `enabled_builtin_tools`.

```json
{
  "agent": "plan-act",
  "messages": [
    { "role": "user", "content": "Remind me what time it is in UTC?" }
  ],
  "enabled_builtin_tools": ["getCurrentTime"]
}
```

MCP tools are loaded via the same module. Initialize them during startup and hand the combined server/MCP toolset to `createChatAgent` when you need custom wiring.

```ts
import { createChatAgent } from '@packages/agents';
import { getActiveToolsAsync, initializeMCPToolsInBackground } from '@packages/tools';

initializeMCPToolsInBackground();

async function buildAgent() {
  const tools = await getActiveToolsAsync(['calculator', 'addPlanSteps']);
  return createChatAgent({ tools });
}
```

The Plan‑Act adapter merges these server-defined tools automatically so the model only sees vetted server or MCP capabilities.

## Extending Agents

1. **Add tools** in `packages/tools/src/index.ts` using `tool({...})` helpers from `ai`. Export them via `defaultToolset`.
2. **Compose behavior** in `packages/agents/src/agent.ts` — adjust parsing, add system prompts, tool-choice strategies, or handle streaming callbacks.
3. **Expose additional endpoints** in `apps/api`, injecting the shared agent or creating new Nest providers per use case.
4. **Logging & telemetry** — reuse `packages/logger` or plug in distributed tracing as needed.

Keep this file updated when adding new agents, tools, or endpoints so automation and LLMs can rely on current context.

User notes:
- When testing don't overwrite the model being used unless it is a recent or new model that is low cost such as gpt-5-mini, kimi k2, claude-haiku-4-5, grok-code-fast-1, grok-4-fast-reasoning, grok-4-fast-non-reasoning. This is to avoid getting upcharged for lower quality legacy models. I prefer the model I have specified in the .env the most.
- Never ever commit changes. Never undo previous commits. Never `git reset`. I will manage the repo myself do not touch any of my git stuff.

---

# Claude Code Workflow Instructions

This section provides persistent instructions for Claude Code AI assistant sessions, establishing a plan-then-act workflow using **OpenAI Codex CLI** run directly in the terminal for maximum visibility and control.

## Using Codex as a Sub-Agent

OpenAI Codex CLI (`codex`) is a powerful tool powered by GPT-5-Codex that excels at deep reasoning and complex planning. Claude Code uses it as a sub-agent for planning complex tasks.

### When to Use Codex

Use `codex exec` when:
- User explicitly asks to "use codex" as a tool
- Multi-file refactoring or architectural changes needed
- Complex feature planning with many edge cases
- Deep codebase analysis required
- Migration or upgrade planning needed

### How to Use Codex Exec

```bash
# For planning (read-only, high reasoning)
codex exec --profile analyze --sandbox read-only "Create detailed plan to [task]"

# For simpler analysis
codex exec --sandbox read-only "Analyze [specific aspect]"
```

**Key Options:**
- `--profile analyze`: Uses high reasoning effort, ideal for planning
- `--sandbox read-only`: Safe for planning, can't modify files
- `--sandbox workspace-write`: Can modify files (use with caution)

**Output:**
- Final plan/analysis is in stdout
- Reasoning process is in stderr (for debugging)
- Exit code 0 = success

### Workflow

**For Planning:**
1. **Detect Complex Task**: User asks for Codex or task is multi-file/complex
2. **Run Codex Analysis**: Execute `codex exec --profile analyze --sandbox read-only` with comprehensive prompt
3. **Parse Output**: Extract plan from stdout
4. **Present Summary**: Show user the key points from Codex's plan
5. **Get Approval**: Wait for user confirmation before implementing

**For Implementation:**
1. **Identify Natural Task Groups**: Look for logical groupings (e.g., code changes vs docs, or related file clusters)
2. **Launch Parallel Codex Tasks**: Run multiple `codex exec --sandbox workspace-write` instances simultaneously
3. **Monitor Progress**: Track completion of parallel tasks
4. **Verify**: Run lint/build/tests after all tasks complete

### Example - Comprehensive Single Task

```bash
# Codex is highly intelligent - give it the full scope
codex exec --sandbox workspace-write "Remove all client tool support from the codebase:
- Delete CLIENT execution mode, ClientExecutionRequiredError, and all client tool functions
- Update plan-act agent, adapter, converter, merger, and tool index files
- Update AGENTS.md and TOOL_CALLING.md documentation
- Keep all server/MCP tool functionality intact
- Ensure code compiles and follows existing patterns"
```

### Example - Parallel Execution for Speed

```bash
# Launch multiple independent tasks in parallel (in a single message)
# Task 1: Core code changes
codex exec --sandbox workspace-write "Remove client tools from packages/agents/src/tools/: converter.ts, merger.ts, types.ts - remove CLIENT mode, error classes, and client tool functions"

# Task 2: Agent updates
codex exec --sandbox workspace-write "Update plan-act agent and adapter to remove all client tool handling - simplify error handling and remove clientTools parameters"

# Task 3: Documentation
codex exec --sandbox workspace-write "Update AGENTS.md and TOOL_CALLING.md to describe server/MCP-only workflow, remove all client tool references"
```

### Best Practices

**Task Scoping:**
- ⚡ **Trust Codex's Intelligence**: Don't over-subdivide - Codex can handle comprehensive, multi-file tasks
- 🚀 **Maximize Parallelism**: For speed, run 2-4 independent Codex tasks simultaneously
- 🎯 **Group Logically**: Split by natural boundaries (code vs docs, frontend vs backend) not by individual files
- 📋 **Be Specific**: Provide clear requirements and constraints in each prompt

**Execution:**
- Use `--sandbox read-only` for analysis/planning only
- Use `--profile analyze` for complex reasoning tasks
- Use `--sandbox workspace-write` for implementation
- Launch parallel tasks in a single message for true concurrency
- Verify all changes with lint/build after Codex completes

**Anti-patterns:**
- ❌ Don't create one Codex task per file - that's too granular
- ❌ Don't run tasks sequentially when they could run in parallel
- ❌ Don't micromanage Codex with overly detailed line-by-line instructions
