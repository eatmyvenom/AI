import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let envLoaded = false;

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

  const envPath = resolve(process.cwd(), process.env.ENV_FILE ?? '.env');

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
