Monorepo Setup: NestJS + Vercel AI SDK v5 + pnpm + Turbo

This guide bootstraps a Turbo monorepo with:
* Apps
  * apps/api — NestJS server that exposes an OpenAI chat-completions–compatible endpoint and hosts your agents
* Packages
  * packages/agents — your agent definitions & orchestration (Vercel AI SDK v5)
  * packages/tools — your tool system with zod schemas + decorators
* packages/logger — shared custom logger with colorized output & Nest adapter
* Tooling
  * pnpm workspaces, Turborepo, TypeScript project refs
  * ESLint (flat config) aligned with patterns used in Statsify/statsify
  * Single root .env consumed everywhere
* DX niceties
  * Per-package import alias: #services/... resolves to that package/app’s root (e.g., #services/promptUtils → ./services/promptUtils inside that package/app)
  * VS Code settings for path/intellisense

References you may want handy:
* Vercel AI SDK v5 docs & blog (providers, tools, OpenAI-compatible)  ￼
* OpenAI-compatible providers with @ai-sdk/openai-compatible (point at any /v1/chat/completions)  ￼
* Vercel AI Gateway OpenAI-compatible base URL details (if you route through Vercel’s gateway)  ￼
* Statsify monorepo structure (flat ESLint, turbo.json, tsconfig.base.json, pnpm-workspace.yaml)  ￼
* TypeScript paths for aliases (official docs)  ￼
* nestjs-zod (zod with NestJS decorators/DTOs)  ￼

⸻

## 0) Prereqs
* Node 20+ and pnpm installed (npm i -g pnpm)
* Git initialized (git init)

⸻

## 1) Workspace skeleton
```bash
# 1) Create folders
mkdir -p apps/api \
         packages/agents/src \
         packages/tools/src \
         packages/logger/src

# 2) Initialize root
pnpm init -y

# 3) Workspace + turbo
pnpm add -D turbo typescript ts-node @types/node tsc-alias

# 4) ESLint (flat config) + helpful plugins
pnpm add -D eslint @eslint/js typescript-eslint \
  eslint-plugin-import eslint-plugin-promise \
  eslint-plugin-unused-imports

# 5) Vercel AI SDK v5 + providers
pnpm add ai @ai-sdk/openai @ai-sdk/openai-compatible zod

# 6) NestJS app deps
pnpm add -w @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs
pnpm add -Dw @nestjs/cli @nestjs/schematics @nestjs/testing

# 7) Zod + Nest decorators
pnpm add -w nestjs-zod

# 8) Logger helpers
pnpm add -w colorette

# 9) Misc DX
pnpm add -D rimraf
```

Create these root files:

**package.json (root)**
```json
{
  "name": "ai-monorepo",
  "private": true,
  "packageManager": "pnpm@9",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "clean": "rimraf node_modules && rimraf .turbo && rimraf dist && turbo run clean"
  },
  "devDependencies": {
    "turbo": "^2.1.0"
  }
}
```
**pnpm-workspace.yaml**
```yaml
packages:
  - "apps/*"
  - "packages/*"
```
**turbo.json**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["NODE_ENV", "PROVIDER_API_KEY", "PROVIDER_BASE_URL", "MODEL", "PORT"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "test": {},
    "clean": {
      "cache": false
    }
  }
}
```
**tsconfig.base.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "useDefineForClassFields": false
  }
}
```
We’ll add per-package tsconfig.json files that extend this and install the #* alias (see §5).

**eslint.config.js (flat config)**

This mirrors the flat approach (eslint.config.js) you’ll see in Statsify and modern repos, using TypeScript ESLint + popular plugins. (Statsify itself has a root eslint.config.js and a monorepo with apps/ + packages/ folders, which we follow here.  ￼)
```javascript
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import promise from 'eslint-plugin-promise';
import unused from 'eslint-plugin-unused-imports';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: false, sourceType: 'module' }
    },
    plugins: { import: importPlugin, promise, 'unused-imports': unused },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'import/order': [
        'warn',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']]
        }
      ],
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
);
```
**.vscode/settings.json (optional but helpful)**
```json
{
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "eslint.useFlatConfig": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```
**.env (root)**
```bash
# Provider can be OpenAI-compatible (e.g., Vercel AI Gateway, Cloudflare Workers AI, etc.)
PROVIDER_API_KEY="replace-me"
PROVIDER_BASE_URL="https://ai-gateway.vercel.sh/v1" # or your provider’s /v1 base
MODEL="gpt-4o-mini" # or your provider’s chat model id
PORT=3000
NODE_ENV=development
```
AI SDK v5 supports OpenAI-compatible providers via @ai-sdk/openai-compatible—set baseURL and API key for your provider (any API that implements /v1/chat/completions). If you route through Vercel AI Gateway, its OpenAI-compatible base URL is https://ai-gateway.vercel.sh/v1.  ￼

⸻

## 2) Packages

### 2.1 packages/logger

**packages/logger/package.json**
```json
{
  "name": "@repo/logger",
  "version": "0.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "commonjs",
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc-alias",
    "dev": "pnpm build --watch",
    "lint": "eslint .",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "colorette": "^2.0.20"
  },
  "peerDependencies": {
    "@nestjs/common": "^10.0.0"
  },
  "devDependencies": {
    "@nestjs/common": "^10.0.0"
  }
}
```
**packages/logger/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "#*": ["./*"] }
  },
  "include": ["src"]
}
```
**packages/logger/src/index.ts**
```typescript
import { cyan, green, red, yellow } from 'colorette';
import { DynamicModule, Global, LoggerService as NestLoggerService, Module } from '@nestjs/common';
import { inspect } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_COLORS: Record<LogLevel, (value: string) => string> = {
  debug: cyan,
  info: green,
  warn: yellow,
  error: red
};

const WRITERS: Record<LogLevel, (line: string) => void> = {
  debug: console.debug.bind(console),
  info: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

const INSPECT_OPTIONS = { depth: null, colors: false } as const;

function serialize(parts: unknown[]): string {
  if (!parts.length) {
    return '';
  }

  return parts
    .filter((part) => part !== undefined)
    .map((part) =>
      typeof part === 'string' ? part : inspect(part, INSPECT_OPTIONS)
    )
    .join(' ');
}

function emitLine(packageName: string, level: LogLevel, parts: unknown[]) {
  const timestamp = new Date().toISOString();
  const levelLabel = LEVEL_COLORS[level](`[${level.toUpperCase()}]`);
  const message = serialize(parts);
  const line = message
    ? `[${timestamp}] [${packageName}] ${levelLabel} ${message}`
    : `[${timestamp}] [${packageName}] ${levelLabel}`;

  WRITERS[level](line);
}

export interface PlainLogger {
  debug: (...parts: unknown[]) => void;
  info: (...parts: unknown[]) => void;
  warn: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
}

export function createLogger(packageName = 'app'): PlainLogger {
  const log = (level: LogLevel, parts: unknown[]) => emitLine(packageName, level, parts);
  return {
    debug: (...parts) => log('debug', parts),
    info: (...parts) => log('info', parts),
    warn: (...parts) => log('warn', parts),
    error: (...parts) => log('error', parts)
  };
}

export interface LoggerModuleOptions {
  packageName?: string;
}

export class LoggerService implements NestLoggerService {
  constructor(private readonly packageName: string) {}

  log(message: unknown, ...optionalParams: unknown[]) {
    emitLine(this.packageName, 'info', [message, ...optionalParams]);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    emitLine(this.packageName, 'error', [message, ...optionalParams]);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    emitLine(this.packageName, 'warn', [message, ...optionalParams]);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    emitLine(this.packageName, 'debug', [message, ...optionalParams]);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    emitLine(this.packageName, 'debug', [message, ...optionalParams]);
  }
}

@Global()
@Module({})
export class LoggerModule {
  static forRoot(options?: LoggerModuleOptions): DynamicModule {
    const packageName = options?.packageName ?? 'app';

    return {
      module: LoggerModule,
      providers: [
        {
          provide: LoggerService,
          useValue: new LoggerService(packageName)
        }
      ],
      exports: [LoggerService]
    };
  }
}
```
The custom logger prints `[timestamp] [package] [LEVEL] message`, colorizes the bracketed level by severity, and exposes both a simple factory (`createLogger`) and `LoggerModule.forRoot` for Nest usage.

⸻

### 2.2 packages/tools (your tool system)

**packages/tools/package.json**
```json
{
  "name": "@repo/tools",
  "version": "0.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "commonjs",
  "dependencies": {
    "zod": "^3.23.8",
    "nestjs-zod": "^2.0.0" // used in API app when integrating DTOs
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc-alias",
    "dev": "pnpm build --watch",
    "lint": "eslint .",
    "clean": "rimraf dist"
  }
}
```
**packages/tools/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "#*": ["./*"] }
  },
  "include": ["src"]
}
```
**packages/tools/src/index.ts**
```typescript
import { z } from 'zod';
import { tool } from 'ai';

/**
 * Example tool: get weather
 * Showcases Zod schema + AI SDK tool definition
 */
export const weatherTool = tool({
  description: 'Get the weather in a location',
  inputSchema: z.object({
    location: z.string().describe('City, state or "lat,lng"')
  }),
  // placeholder implementation
  execute: async ({ location }) => {
    return { location, temperatureF: 72 };
  }
});

export type ToolMap = {
  weather: typeof weatherTool;
};

export const toolRegistry: Record<keyof ToolMap, any> = {
  weather: weatherTool
};
```
Vercel AI SDK v5 “tool calling” works by passing a tools map to generateText/streamText. Keep them centralized here.  ￼

⸻

### 2.3 packages/agents (your agent logic)

**packages/agents/package.json**
```json
{
  "name": "@repo/agents",
  "version": "0.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "commonjs",
  "dependencies": {
    "ai": "^3.4.0",
    "@ai-sdk/openai": "^0.0.8",
    "@ai-sdk/openai-compatible": "^0.0.7",
    "zod": "^3.23.8",
    "@repo/tools": "workspace:*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc-alias",
    "dev": "pnpm build --watch",
    "lint": "eslint .",
    "clean": "rimraf dist"
  }
}
```
**packages/agents/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "#*": ["./*"] }
  },
  "include": ["src"],
  "references": [{ "path": "../tools" }]
}
```
**packages/agents/src/provider.ts**
```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Create a provider that talks to any OpenAI-compatible /v1 endpoint.
export const provider = createOpenAICompatible({
  name: 'default',
  baseURL: process.env.PROVIDER_BASE_URL,
  apiKey: process.env.PROVIDER_API_KEY
});

packages/agents/src/agent.ts

import { generateText } from 'ai';
import { provider } from './provider';
import { toolRegistry } from '@repo/tools';

export async function runAgent(input: string) {
  const modelId = process.env.MODEL || 'gpt-4o-mini';
  const result = await generateText({
    model: provider(modelId),
    system: 'You are a helpful assistant with access to tools.',
    prompt: input,
    tools: toolRegistry
  });

  return {
    text: result.text,
    steps: result.steps // useful for debugging tool calls
  };
}
```
AI SDK v5 supports OpenAI-compatible providers via createOpenAICompatible, so you can aim at any /v1/chat/completions backend by swapping PROVIDER_BASE_URL (OpenAI, AI Gateway, Cloudflare Workers AI, vLLM, etc.).  ￼

⸻

## 3) App: NestJS API (apps/api)

Initialize app:
```bash
cd apps/api
pnpm init -y
pnpm add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs
pnpm add -D typescript @types/node ts-node tsc-alias
pnpm add @repo/agents @repo/tools @repo/logger
```
**apps/api/package.json**
```json
{
  "name": "@apps/api",
  "version": "0.0.0",
  "private": true,
  "type": "commonjs",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json && tsc-alias",
    "dev": "ts-node -r tsconfig-paths/register src/main.ts",
    "start": "node dist/main.js",
    "lint": "eslint .",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@repo/agents": "workspace:*",
    "@repo/logger": "workspace:*",
    "@repo/tools": "workspace:*",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0",
    "zod": "^3.23.8",
    "nestjs-zod": "^2.0.0"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "tsconfig-paths": "^4.2.0"
  }
}
```
**apps/api/tsconfig.json**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": { "#*": ["./*"] }
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/agents" },
    { "path": "../../packages/tools" },
    { "path": "../../packages/logger" }
  ]
}
```
Alias rule: per-package tsconfig.json sets baseUrl: "." + paths: { "#\*": ["./\*"] }, so import "#services/promptUtils" resolves to ./services/promptUtils inside that package/app—exactly the behavior you wanted. At runtime, ts-node uses tsconfig-paths/register, and after build we run tsc-alias to rewrite compiled paths. (TypeScript paths reference)  ￼

**apps/api/src/main.ts**
```typescript
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { LoggerService } from '@repo/logger';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(LoggerService);

  app.useLogger(logger);
  await app.listen(Number(process.env.PORT) || 3000);
  logger.log('HTTP server ready');
}
bootstrap();

apps/api/src/modules/app.module.ts

import { Module } from '@nestjs/common';
import { LoggerModule } from '@repo/logger';
import { AppController } from './app.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      packageName: '@apps/api'
    })
  ],
  controllers: [AppController]
})
export class AppModule {}

apps/api/src/modules/app.controller.ts

import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { runAgent } from '@repo/agents';

// OpenAI chat-completions–compatible envelope (minimal)
const ChatCompletionsSchema = z.object({
  model: z.string().optional(), // will default from env
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'system', 'assistant', 'tool']),
        content: z.union([z.string(), z.array(z.any())]) // keep loose for attachments/tools
      })
    )
    .optional(),
  // Optional: temperature, top_p, tools etc. If present, you can thread through.
  temperature: z.number().optional()
});

class ChatCompletionsDto extends createZodDto(ChatCompletionsSchema) {}

@Controller('/v1')
export class AppController {
  @Post('/chat/completions')
  async chat(@Body() body: ChatCompletionsDto) {
    // For simplicity, compose a single prompt from the last user message.
    const input =
      body.messages?.slice().reverse().find((m) => m.role === 'user')?.content ??
      'Hello!';

    const { text, steps } = await runAgent(String(input));

    // Return an OpenAI-like shape
    return {
      id: `chatcmpl_${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? process.env.MODEL,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ],
      usage: {
        // optional if provider includes usage
      },
      // expose steps for debugging if desired (not part of spec)
      _debug: { steps }
    };
  }
}
```
nestjs-zod lets you build DTOs from zod schemas using decorators/validation that play nicely with Nest. (Alternative: write custom pipes/filters, but nestjs-zod is purpose-built for this.)  ￼

⸻

## 4) Example local alias usage

Inside any app/package, put a file like services/promptUtils.ts and import via:
```typescript
import { foo } from '#services/promptUtils';
```
Because that package’s tsconfig.json maps #\* → ./\*, it resolves to \<this package\>/services/promptUtils.

⸻

## 5) Scripts at the root

Add these workspace scripts for each package/app:
* `build` → `tsc && tsc-alias`
* `dev` → `watch` if you prefer (`tsc -w`)
* `lint`, `clean`

You can run:
```bash
pnpm install
pnpm build           # builds all packages & apps (Turbo)
pnpm dev             # dev all (parallel), then hit http://localhost:3000/v1/chat/completions
pnpm -w exec -- nest --version  # sanity check Nest CLI (optional)
```

⸻

## 6) Testing the API quickly
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"hi!"}]}'
```
You should get a JSON response in an OpenAI-like shape with the agent’s answer.

⸻

## 7) What goes where
* Agent logic (prompt templates, memory plans, tool selection policies) → `packages/agents`
* Tool definitions (pure functions w/ zod schemas, side effects, external calls) → `packages/tools`
* Transport/hosting (HTTP, streaming, auth, rate limiting, OpenAI-compat envelope) → `apps/api`
* Cross-cutting logging → `packages/logger`

AI SDK v5 has first-class “tools” and multi-step agent loops; keep those in `packages/tools`, then compose in `packages/agents`.  ￼

⸻

## 8) Common enhancements (optional but recommended)
* Streaming: use streamText in the controller and forward Readable to the client for SSE. (AI SDK supports streaming out-of-the-box.)  ￼
* Gateway: route through Vercel AI Gateway for provider switching, caching, observability, and an OpenAI-compatible base.  ￼
* Swagger: nestjs-zod has patterns for Swagger integration from zod DTOs.  ￼
* Env validation: add zod schema for .env in a small config package.
* CI: add Turbo remote cache & lint/test jobs.
* Precommit: lint-staged + pretty-quick if you add Prettier.

⸻

## 9) File tree (target state)
```
.
├─ apps/
│  └─ api/
│     ├─ src/
│     │  └─ modules/
│     │     ├─ app.controller.ts
│     │     └─ app.module.ts
│     ├─ package.json
│     └─ tsconfig.json
├─ packages/
│  ├─ agents/
│  │  ├─ src/
│  │  │  ├─ agent.ts
│  │  │  └─ provider.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ tools/
│  │  ├─ src/
│  │  │  └─ index.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  └─ logger/
│     ├─ src/
│     │  └─ index.ts
│     ├─ package.json
│     └─ tsconfig.json
├─ .env
├─ eslint.config.js
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ tsconfig.base.json
```

⸻

## 10) Notes on zod + decorators
* In Nest codepaths (controllers/DTOs), use nestjs-zod (createZodDto, pipes, etc.) to keep a decorator-friendly DX without class-validator.  ￼
* In packages/tools and packages/agents, define schemas directly with zod, since AI SDK tools accept zod schemas natively.  ￼

⸻

## 11) Quick checklist
* `pnpm i` at root
* Create .env with your provider key & base URL
* `pnpm dev` (monorepo) or `pnpm -F @apps/api dev` (just API)
* `curl` the `/v1/chat/completions` endpoint
* Start adding tools in packages/tools and agent prompts/logic in packages/agents

⸻

# Appendix: Why this stack?
* Vercel AI SDK v5 gives you typed agents, tools, streaming, and OpenAI-compatible providers behind a single API.  ￼
* OpenAI-compatible lets you point at any `/v1/chat/completions` backend by swapping the baseURL (OpenAI, Vercel AI Gateway, Cloudflare Workers AI, vLLM, etc.).  ￼
* NestJS + `nestjs-zod` keeps a decorator-based DX for DTOs while using zod as the single source of truth.  ￼
* Turbo + pnpm is a well-trodden monorepo pairing (matching Statsify’s monorepo vibe).  ￼
* Per-package `#` alias avoids deep relative imports and stays local to each workspace, with TypeScript paths + `ts-node/tsc-alias` handling runtime resolution.  ￼
