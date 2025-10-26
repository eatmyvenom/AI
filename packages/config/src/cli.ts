import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfigWithMigration, validateConfigSafe } from './loader';

const DEFAULT_CONFIG_PATHS = [
  './config.js',
  './config.json',
  './config.ts',
  './src/config.js',
  './src/config.json',
  './src/config.ts',
];

function showUsage() {
  console.log(`
AI Agent Configuration CLI

Usage:
  config validate [path]    - Validate configuration file
  config show [path]        - Show current configuration
  config migrate            - Generate config from environment variables
  config schema             - Generate JSON schema for IDE support

Examples:
  config validate
  config validate ./my-config.js
  config show
  config migrate > config.js
  config schema > config.schema.json
`);
}

function findConfigFile(customPath?: string): string | null {
  if (customPath) {
    const resolved = resolve(customPath);
    return existsSync(resolved) ? resolved : null;
  }

  // Find project root by looking for pnpm-workspace.yaml or turbo.json
  let currentDir = process.cwd();
  let projectRoot = currentDir;

  // Walk up directory tree to find project root
  while (currentDir !== '/') {
    if (existsSync(resolve(currentDir, 'pnpm-workspace.yaml')) ||
        existsSync(resolve(currentDir, 'turbo.json'))) {
      projectRoot = currentDir;
      break;
    }
    currentDir = resolve(currentDir, '..');
  }

  // Search for config files in project root
  const projectRootPaths = [
    resolve(projectRoot, 'config.js'),
    resolve(projectRoot, 'config.json'),
    resolve(projectRoot, 'config.ts'),
  ];

  for (const path of projectRootPaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // Fallback to current directory paths
  const fallbackPaths = [
    './config.js',
    './config.json',
    './config.ts',
  ];

  for (const path of fallbackPaths) {
    const resolved = resolve(process.cwd(), path);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

function validateConfig(configPath?: string) {
  const path = findConfigFile(configPath);

  if (!path) {
    console.error('❌ No configuration file found');
    console.error('Searched paths:', DEFAULT_CONFIG_PATHS.map(p => resolve(p)));
    process.exit(1);
  }

  console.log(`🔍 Validating configuration: ${path}`);

    try {
      let rawConfig: unknown;

      if (path.endsWith('.json')) {
        const content = readFileSync(path, 'utf8');
        rawConfig = JSON.parse(content);
      } else {
        // For .js and .ts files, use dynamic import
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
        const configModule = require(path);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        rawConfig = configModule.default || configModule;
      }

    const result = validateConfigSafe(rawConfig);

    if (result.success) {
      console.log('✅ Configuration is valid!');
      console.log(`📊 Configuration sections: ${Object.keys(result.data!).join(', ')}`);
      return result.data!;
    } else {
      console.error('❌ Configuration validation failed:');
      console.error('');

      for (const error of result.errors!) {
        console.error(`  • ${error.path.join('.')}: ${error.message}`);
      }

      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to load configuration:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function showConfig(configPath?: string) {
  const path = findConfigFile(configPath);

  if (!path) {
    console.error('❌ No configuration file found');
    process.exit(1);
  }

  console.log(`📄 Configuration file: ${path}`);
  console.log('');

  try {
    const config = loadConfigWithMigration(path);
    console.log(JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('❌ Failed to load configuration:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function migrateFromEnv() {
  console.log(`🔄 Generating configuration from environment variables...`);
  console.log('');

  try {
    const config = loadConfigWithMigration();
    console.log(`module.exports = ${JSON.stringify(config, null, 2)};`);
    console.log('');
    console.log('💡 Save this output to config.js and customize as needed.');
  } catch (error) {
    console.error('❌ Failed to generate configuration:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function generateSchema() {
  console.log(`📋 Generating JSON schema for IDE support...`);
  console.log('');

  try {
    // Read the JSON schema file from the project root
    const cwd = process.cwd();
    const schemaPath = resolve(cwd, 'config.schema.json');
    const schema = readFileSync(schemaPath, 'utf8');
    console.log(schema);
    console.log('');
    console.log('💡 Save this output to config.schema.json for IDE autocomplete support.');
  } catch (error) {
    console.error('❌ Failed to generate schema:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'validate':
      validateConfig(args[1]);
      break;

    case 'show':
      showConfig(args[1]);
      break;

    case 'migrate':
      migrateFromEnv();
      break;

    case 'schema':
      generateSchema();
      break;

    default:
      showUsage();
      break;
  }
}

if (require.main === module) {
  main();
}