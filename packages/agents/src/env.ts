import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

let envLoaded = false;

function findMonorepoRoot(startPath: string): string {
  let currentPath = startPath;

  while (currentPath !== dirname(currentPath)) {
    // Check for pnpm-workspace.yaml or turbo.json as monorepo indicators
    if (existsSync(resolve(currentPath, 'pnpm-workspace.yaml')) ||
        existsSync(resolve(currentPath, 'turbo.json'))) {
      return currentPath;
    }
    currentPath = dirname(currentPath);
  }

  // Fallback to original path if no monorepo root found
  return startPath;
}

function parseLine(line: string) {
  const separatorIndex = line.indexOf('=');
  if (separatorIndex === -1) {
    return undefined;
  }

  let key = line.slice(0, separatorIndex).trim();
  if (key.startsWith('export ')) {
    key = key.slice('export '.length).trim();
  }

  if (key.length === 0) {
    return undefined;
  }

  let value = line.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function ensureEnv() {
  if (envLoaded) {
    return;
  }

  // Find monorepo root to load .env from there
  const monorepoRoot = findMonorepoRoot(process.cwd());
  const envPath = resolve(monorepoRoot, process.env.ENV_FILE ?? '.env');

  if (!existsSync(envPath)) {
    envLoaded = true;
    return;
  }

  const raw = readFileSync(envPath, 'utf8');

  for (const candidate of raw.split(/\r?\n/)) {
    const line = candidate.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const parsed = parseLine(line);

    if (!parsed) {
      continue;
    }

    if (!(parsed.key in process.env)) {
      process.env[parsed.key] = parsed.value;
    }
  }

  envLoaded = true;
}

// Ensure we read the file on first import so other modules can rely on process.env.
ensureEnv();
