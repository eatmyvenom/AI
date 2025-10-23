/**
 * MCP Client Manager
 *
 * Manages MCP client connections and tool retrieval.
 * Provides a singleton interface for accessing MCP tools throughout the application.
 */

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { experimental_createMCPClient } from 'ai';
import type { ToolSet } from 'ai';

import {
  getMCPServerConfigs,
  isMCPEnabled,
  MCPTransportType,
  type MCPServerConfig,
  type MCPTransportConfig,
} from './mcp-config';

interface MCPClient {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any; // MCP client from experimental_createMCPClient
  tools: ToolSet;
}

/**
 * Singleton MCP client manager
 */
class MCPClientManager {
  private clients: Map<string, MCPClient> = new Map();
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  /**
   * Initialize all configured MCP clients
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.initialized) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this.doInitialize();
    await this.initializationPromise;
    this.initialized = true;
    this.initializationPromise = null;
  }

  private async doInitialize(): Promise<void> {
    // Check if MCP is enabled globally
    if (!isMCPEnabled()) {
      console.log('[MCP] MCP tools are disabled');
      return;
    }

    const configs = getMCPServerConfigs();
    console.log(`[MCP] Initializing ${configs.length} MCP server(s)`);

    const results = await Promise.allSettled(
      configs.map(config => this.initializeClient(config))
    );

    // Log results
    let successCount = 0;
    let failureCount = 0;

    results.forEach((result, index) => {
      const config = configs[index];
      if (result.status === 'fulfilled') {
        successCount++;
        console.log(`[MCP] ✓ Successfully initialized MCP server: ${config.name} (${config.id})`);
      } else {
        failureCount++;
        console.error(`[MCP] ✗ Failed to initialize MCP server: ${config.name} (${config.id})`, result.reason);
      }
    });

    console.log(`[MCP] Initialization complete: ${successCount} succeeded, ${failureCount} failed`);
  }

  private async initializeClient(config: MCPServerConfig): Promise<void> {
    try {
      // Create transport based on configuration
      const transport = this.createTransport(config.transport);

      // Create MCP client using AI SDK's experimental API
      const client = await experimental_createMCPClient({ transport });

      // Retrieve tools from the MCP server
      const tools = await client.tools();

      // Filter tools if specific tools are enabled
      let filteredTools = tools;
      if (config.enabledTools && config.enabledTools.length > 0) {
        filteredTools = Object.fromEntries(
          Object.entries(tools).filter(([toolName]) =>
            config.enabledTools!.includes(toolName)
          )
        );
      }

      // Store the client
      this.clients.set(config.id, {
        id: config.id,
        name: config.name,
        client,
        tools: filteredTools,
      });

      console.log(`[MCP] Loaded ${Object.keys(filteredTools).length} tool(s) from ${config.name}`);
    } catch (error) {
      console.error(`[MCP] Error initializing client ${config.id}:`, error);
      throw error;
    }
  }

  private createTransport(config: MCPTransportConfig) {
    switch (config.type) {
      case MCPTransportType.STDIO:
        return new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
        });

      case MCPTransportType.SSE:
        return new SSEClientTransport(new URL(config.url));

      case MCPTransportType.HTTP:
        return new StreamableHTTPClientTransport(new URL(config.url));

      default:
        // SHUT THE FUCK UP
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        throw new Error(`Unknown transport type: ${(config as any)?.type ?? "undefined"}`);
    }
  }

  /**
   * Get all MCP tools as a single merged ToolSet
   */
  async getTools(): Promise<ToolSet> {
    await this.initialize();

    const allTools: ToolSet = {};

    // Yeah, I know, IDC
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [_serverId, client] of this.clients.entries()) {
      // Merge tools from all clients
      // Note: Later servers will override tools with the same name
      Object.assign(allTools, client.tools);
    }

    return allTools;
  }

  /**
   * Get tools from a specific MCP server
   */
  async getToolsFromServer(serverId: string): Promise<ToolSet | null> {
    await this.initialize();

    const client = this.clients.get(serverId);
    return client ? client.tools : null;
  }

  /**
   * Get list of available MCP server IDs
   */
  async getServerIds(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a specific MCP server is initialized
   */
  async hasServer(serverId: string): Promise<boolean> {
    await this.initialize();
    return this.clients.has(serverId);
  }

  /**
   * Close all MCP clients and release resources
   */
  async close(): Promise<void> {
    console.log(`[MCP] Closing ${this.clients.size} MCP client(s)`);

    const closePromises = Array.from(this.clients.values()).map(async ({ id, client }) => {
      try {
        // THATS THE POINT
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (client && typeof client.close === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await client.close();
          console.log(`[MCP] ✓ Closed MCP client: ${id}`);
        }
      } catch (error) {
        console.error(`[MCP] ✗ Error closing MCP client ${id}:`, error);
      }
    });

    await Promise.allSettled(closePromises);

    this.clients.clear();
    this.initialized = false;
    this.initializationPromise = null;

    console.log('[MCP] All MCP clients closed');
  }

  /**
   * Reset the manager (for testing purposes)
   */
  async reset(): Promise<void> {
    await this.close();
  }
}

// Export singleton instance
export const mcpClientManager = new MCPClientManager();

/**
 * Get MCP tools (convenience function)
 */
export async function getMCPTools(): Promise<ToolSet> {
  return mcpClientManager.getTools();
}

/**
 * Close all MCP clients (convenience function)
 */
export async function closeMCPClients(): Promise<void> {
  return mcpClientManager.close();
}
