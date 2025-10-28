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

---

# Claude Code Workflow Instructions

This section provides persistent instructions for Claude Code AI assistant sessions, establishing a plan-then-act workflow using Codex CLI integration via MCP.

## ⚠️ CRITICAL: Codex Delegation Protocol

**When the user requests to "use Codex" or mentions Codex, Claude Code acts as an orchestrator/intermediary:**

### Primary Actor: Codex
- **Default behavior**: Delegate to Codex first for all work
- Codex handles: analysis → planning → implementation
- Codex has full codebase context and executes changes
- Codex is the primary actor that does the heavy lifting

### Intermediary Role: Claude Code
Claude Code orchestrates the workflow and provides support:

**Primary Responsibilities:**
- Delegate tasks to `@codex-planner` (Plan Mode) or `@codex-actor` (Normal Mode)
- Monitor Codex's progress and relay results to the user
- Ensure the task is completed successfully

**Support Responsibilities (when Codex needs help):**
- **If Codex struggles**: Gather additional information by reading files or analyzing code
- **If Codex needs clarification**: Ask the user for more details
- **If Codex fails to make a change**: Step in and make the change yourself
- **If Codex's output is incomplete**: Fill in the gaps or complete remaining work

**Key Principle**: Try Codex first, but don't let the task fail. Claude Code ensures the job gets done right, even if that means stepping in to help.

### Mode-Based Tool Selection

**IMPORTANT: Always use the correct tool based on the current mode:**

| Mode | Tool to Use | Sandbox | Purpose |
|------|-------------|---------|---------|
| **Plan Mode** | `@codex-planner` | read-only | Analysis, planning, architecture review |
| **Act Mode / Normal** | `@codex-actor` | workspace-write | Implementation, refactoring, file modifications |

**Rules:**
- In Plan Mode (Shift+Tab) → ALWAYS use `@codex-planner`
- In Act/Normal Mode → ALWAYS use `@codex-actor`
- NEVER use `@codex-actor` in Plan Mode
- NEVER use `@codex-planner` outside Plan Mode

### Example Workflow

**User says:** "Use Codex to remove all client tools from the plan-act agent"

**Correct approach:**
```
1. ✅ Delegate to Codex first:
   @codex-planner Remove all client tools from the plan-act agent.
   Analyze the current implementation and create a detailed plan.

2. Monitor Codex's response:
   - If Codex succeeds: Show plan to user, proceed with @codex-actor after approval
   - If Codex asks for more info: Read relevant files or ask user for clarification
   - If Codex's plan is incomplete: Fill in missing details myself
   - If Codex fails: Step in and complete the task myself

3. Ensure task completion:
   If @codex-actor makes changes but misses something, make the fix myself.
```

**Wrong approach:**
```
❌ Skip Codex entirely and do everything yourself
❌ Let Codex fail without helping
❌ Leave the task incomplete if Codex struggles
```

### Delegation Pattern

```
User Request
    ↓
Claude Code (orchestrator/intermediary)
    ↓
@codex-planner or @codex-actor (primary actor) ←─┐
    ↓                                              │
    ├─ Success? → Results → User                  │
    ├─ Needs info? → Claude Code gathers info ────┘
    ├─ Incomplete? → Claude Code fills gaps
    └─ Failed? → Claude Code steps in and completes
```

**Division of Labor:**
- **Codex**: Primary actor - does the heavy lifting first
- **Claude Code**: Orchestrator/intermediary - delegates, monitors, assists, ensures completion

## Planning Workflow

For any complex feature, refactoring, or architectural change, follow this two-phase workflow:

### Phase 1: Planning (Read-Only Analysis)

**When to use:**
- Multi-file refactoring or restructuring
- New feature development affecting multiple components
- Architecture decisions requiring analysis
- Complex bug fixes spanning multiple files
- Performance optimization planning

**Process:**
1. **Enter Plan Mode** (Shift+Tab in Claude Code)
2. **Use `@codex-planner`** MCP tool to analyze the codebase and create a detailed implementation plan
3. **Request a plan that includes:**
   - All files that need to be created or modified
   - Step-by-step implementation sequence
   - Edge cases and error handling considerations
   - Testing strategy and test cases
   - Potential risks and rollback strategy
   - Estimated complexity and time
4. **Present the plan** to the user and wait for explicit approval
5. **Do NOT proceed** to implementation until approval is received

### Phase 2: Acting (Execution)

**After approval:**
1. **Use `@codex-actor`** MCP tool for implementation
2. **Follow the approved plan** systematically
3. **Execute changes** file by file in the planned order
4. **Run tests** after each significant change
5. **Document** any deviations from the plan with reasoning
6. **Report progress** as you complete each planned step

### When to Skip Planning

For simple, low-risk tasks, proceed directly without the planning phase:
- Fixing typos or formatting issues
- Single-line bug fixes with obvious solutions
- Adding comments or documentation
- Updating dependencies (when straightforward)
- Simple configuration changes

**Rule of thumb:** If the change affects 3+ files or involves non-trivial logic, use the planning phase.

## Codex MCP Integration

This project uses two separate Codex MCP servers with different permissions:

### codex-planner (Analysis Mode)
- **Sandbox:** `read-only` - Cannot modify files
- **Approval policy:** `on-request` - Suggests actions for approval
- **Use for:** Code analysis, planning, architecture review, documentation reading
- **Model:** Uses OpenAI GPT models optimized for code (e.g., GPT-5-Codex)

### codex-actor (Execution Mode)
- **Sandbox:** `workspace-write` - Can modify files in the workspace
- **Approval policy:** `on-failure` - Auto-approves successful operations, pauses on errors
- **Use for:** Implementation, refactoring, bug fixes, file creation/modification
- **Model:** Uses OpenAI GPT models optimized for code

## Best Practices

### Planning Phase
- Be thorough: Better to over-plan than under-plan
- Consider alternatives: Present multiple approaches when applicable
- Think about testing: Include test strategy in the plan
- Document assumptions: Make implicit requirements explicit
- Estimate complexity: Help user understand scope

### Acting Phase
- Follow the plan: Stick to the approved approach unless you discover issues
- Report deviations: If you need to deviate, explain why
- Test incrementally: Don't wait until the end to test
- Keep context: Reference plan sections when implementing
- Ask for clarification: If plan is unclear, ask before proceeding

## Slash Commands

- **`/plan-with-codex <task description>`** - Automatically triggers planning phase with Codex
- See `.claude/commands/` for all available commands

## MCP Configuration

The MCP configuration is stored in `.mcp.json` (gitignored). To set up:

1. Copy `.mcp.json.example` to `.mcp.json`
2. Replace `your-openai-api-key-here` with your actual OpenAI API key
3. Or set `OPENAI_API_KEY` environment variable

See `PROJECT_CODEX_SETUP.md` for detailed setup instructions.