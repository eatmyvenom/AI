/**
 * MCP Server Configuration
 *
 * Flexible MCP server configuration via environment variables.
 * Simply provide MCP server URLs and the system will configure them automatically.
 */

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
 * Get MCP server configuration from environment variables
 *
 * Configuration via environment variables:
 *
 * Simple approach (recommended):
 * - MCP_SERVER_URLS: Comma-separated list of HTTP/SSE URLs
 *   Example: MCP_SERVER_URLS=https://mcp.tavily.com/mcp/?tavilyApiKey=xxx,https://another-server.com/mcp
 *
 * Advanced approach (per-server config):
 * - MCP_SERVER_1_URL: URL for server 1
 * - MCP_SERVER_1_TRANSPORT: Transport type (http, sse, stdio)
 * - MCP_SERVER_1_NAME: Optional custom name
 * - MCP_SERVER_2_URL: URL for server 2
 * - ... and so on
 *
 * All servers default to HTTP transport unless specified otherwise.
 */
export function getMCPServerConfigs(): MCPServerConfig[] {
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
 * Check if MCP tools are enabled globally
 */
export function isMCPEnabled(): boolean {
  return process.env.DISABLE_MCP_TOOLS !== 'true';
}
