/**
 * MCP Server Configuration
 *
 * Flexible MCP server configuration via configuration file.
 * Supports HTTP, SSE, and STDIO transports with full configuration options.
 */

import { loadConfigWithMigration } from '@packages/config';
import type { MCPServerConfig as ConfigMCPServerConfig } from '@packages/config';

// Re-export types from config package for backward compatibility
export enum MCPTransportType {
  STDIO = 'stdio',
  SSE = 'sse',
  HTTP = 'http'
}

export interface StdioTransportConfig {
  type: MCPTransportType.STDIO;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SSETransportConfig {
  type: MCPTransportType.SSE;
  url: string;
}

export interface HTTPTransportConfig {
  type: MCPTransportType.HTTP;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export type MCPTransportConfig = StdioTransportConfig | SSETransportConfig | HTTPTransportConfig;

export interface MCPServerConfig {
  /** Unique identifier for this MCP server */
  id: string;
  /** Human-readable name */
  name: string;
  /** Transport configuration */
  transport: MCPTransportConfig;
  /** Whether this server is enabled (can be overridden by env vars) */
  enabled: boolean;
  /** Optional: specific tools to enable from this server (empty = all) */
  enabledTools?: string[];
  /** Retry configuration */
  retry?: {
    attempts: number;
    backoff: 'linear' | 'exponential';
  };
}

/**
 * Convert config package MCP server config to legacy format for backward compatibility
 */
function configToLegacyServer(configServer: ConfigMCPServerConfig): MCPServerConfig {
  const transport = configServer.transport as MCPTransportConfig;

  return {
    id: configServer.id,
    name: configServer.name,
    transport,
    enabled: configServer.enabled,
    enabledTools: configServer.enabledTools,
    retry: configServer.retry,
  };
}

/**
 * Get MCP server configuration from configuration file
 *
 * Configuration is now loaded from config.js or config.json file.
 * Falls back to environment variables for backward compatibility.
 *
 * See config.example.js for the recommended configuration format.
 */
export function getMCPServerConfigs(): MCPServerConfig[] {
  try {
    const config = loadConfigWithMigration();

    if (config.mcp.enabled && config.mcp.servers.length > 0) {
      return config.mcp.servers.map(configToLegacyServer);
    }

    return getLegacyMCPServerConfigs();
  } catch {
    return getLegacyMCPServerConfigs();
  }
}

/**
 * Get MCP server configuration from legacy environment variables (backward compatibility)
 */
function getLegacyMCPServerConfigs(): MCPServerConfig[] {
  const configs: MCPServerConfig[] = [];

  // Simple approach: MCP_SERVER_URLS
  if (process.env.MCP_SERVER_URLS) {
    const urls = process.env.MCP_SERVER_URLS.split(',').map(u => u.trim()).filter(u => u.length > 0);

    urls.forEach((url, index) => {
      const id = generateServerId(url, index + 1);
      const name = generateServerName(url);

      // Default to HTTP transport for URLs
      const transport: MCPTransportConfig = {
        type: MCPTransportType.HTTP,
        url,
      };

      configs.push({
        id,
        name,
        transport,
        enabled: true,
      });
    });
  }

  // Advanced approach: MCP_SERVER_N_URL
  for (let i = 1; i <= 10; i++) {
    const urlKey = `MCP_SERVER_${i}_URL`;
    const transportKey = `MCP_SERVER_${i}_TRANSPORT`;
    const nameKey = `MCP_SERVER_${i}_NAME`;

    const url = process.env[urlKey];
    if (!url) continue;

    const transportType = (process.env[transportKey]?.toLowerCase() || 'http') as MCPTransportType;
    const customName = process.env[nameKey];

    const id = `mcp-server-${i}`;
    const name = customName || generateServerName(url);

    let transport: MCPTransportConfig;
    if (transportType === MCPTransportType.STDIO) {
      // For stdio, URL should be the command
      transport = {
        type: MCPTransportType.STDIO,
        command: url,
        args: process.env[`MCP_SERVER_${i}_ARGS`]?.split(' '),
      };
    } else if (transportType === MCPTransportType.SSE) {
      transport = {
        type: MCPTransportType.SSE,
        url,
      };
    } else {
      transport = {
        type: MCPTransportType.HTTP,
        url,
      };
    }

    configs.push({
      id,
      name,
      transport,
      enabled: true,
    });
  }

  return configs;
}

/**
 * Generate a server ID from a URL
 */
function generateServerId(url: string, index: number): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/\./g, '-');
    return `mcp-${hostname}-${index}`;
  } catch {
    return `mcp-server-${index}`;
  }
}

/**
 * Generate a server name from a URL
 */
function generateServerName(url: string): string {
  try {
    const urlObj = new URL(url);
    return `MCP Server (${urlObj.hostname})`;
  } catch {
    return 'MCP Server';
  }
}

/**
 * Check if MCP tools are enabled globally
 */
export function isMCPEnabled(): boolean {
  try {
    const config = loadConfigWithMigration();
    return config.mcp.enabled;
  } catch {
    return process.env.DISABLE_MCP_TOOLS !== 'true';
  }
}

export function getMCPGlobalConfig() {
  try {
    const config = loadConfigWithMigration();
    return config.mcp.global;
  } catch {
    return {
      timeout: 60000,
      retry: {
        attempts: 2,
        backoff: 'exponential' as const,
      },
    };
  }
}
