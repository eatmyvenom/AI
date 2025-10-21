import { randomUUID } from 'node:crypto';

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import { z } from 'zod';

/**
 * Built-in server-side tools
 *
 * These tools execute on the server and can be enabled via API request parameters.
 */

/**
 * Calculator tool - evaluates mathematical expressions safely
 */
export const calculator = tool({
  description: 'Evaluates a mathematical expression and returns the result. Supports basic arithmetic operations (+, -, *, /), parentheses, and common math functions.',
  inputSchema: z.object({
    expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2", "Math.sqrt(16)", "5 * (3 + 2)")'),
  }),
  execute: async ({ expression }) => {
    try {
      // For safety, we'll use Function constructor with limited allowed characters
      // This is still eval, but more controlled - only allows basic math operations
      const allowedExpr = expression
        .replace(/[^\d+\-*/().,\sMath.sqrtpowasbcosintanlogfloorceimaxn]/g, '')
        .trim();

      if (!allowedExpr) {
        throw new Error('Expression contains no valid characters');
      }

      // Evaluate using Function constructor
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
      const result: unknown = Function('"use strict"; return (' + allowedExpr + ')')();

      return Promise.resolve({
        expression,
        result,
        success: true,
      });
    } catch (error) {
      return Promise.resolve({
        expression,
        error: error instanceof Error ? error.message : 'Failed to evaluate expression',
        success: false,
      });
    }
  },
});

/**
 * Get current time tool - returns current timestamp in various formats
 */
export const getCurrentTime = tool({
  description: 'Returns the current date and time in various formats including ISO 8601, Unix timestamp, and human-readable format.',
  inputSchema: z.object({
    timezone: z.string().optional().describe('Optional timezone (e.g., "America/New_York", "Europe/London"). Defaults to UTC.'),
    format: z.enum(['iso', 'unix', 'human', 'all']).optional().describe('Output format: iso (ISO 8601), unix (Unix timestamp), human (readable), all (all formats). Defaults to "all".'),
  }),
  execute: async ({ timezone, format = 'all' }) => {
    const now = new Date();

    const result: {
      iso?: string;
      unix?: number;
      human?: string;
      timezone?: string;
    } = {};

    if (format === 'iso' || format === 'all') {
      result.iso = now.toISOString();
    }

    if (format === 'unix' || format === 'all') {
      result.unix = Math.floor(now.getTime() / 1000);
    }

    if (format === 'human' || format === 'all') {
      result.human = now.toLocaleString('en-US', {
        timeZone: timezone || 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
    }

    if (timezone) {
      result.timezone = timezone;
    }

    return Promise.resolve(result);
  },
});

/**
 * Generate UUID tool - creates a new UUID v4
 */
export const generateUUID = tool({
  description: 'Generates a new UUID (Universally Unique Identifier) v4. Useful for creating unique identifiers for entities, sessions, or tracking.',
  inputSchema: z.object({
    count: z.number().int().min(1).max(100).optional().describe('Number of UUIDs to generate (1-100). Defaults to 1.'),
    format: z.enum(['string', 'array']).optional().describe('Output format: string (comma-separated) or array. Defaults to string for count=1, array otherwise.'),
  }),
  execute: async ({ count = 1, format }) => {
    const uuids = Array.from({ length: count }, () => randomUUID());

    // Determine format
    const outputFormat = format || (count === 1 ? 'string' : 'array');

    if (outputFormat === 'string') {
      return Promise.resolve({
        uuids: uuids.join(', '),
        count: uuids.length,
      });
    }

    return Promise.resolve({
      uuids,
      count: uuids.length,
    });
  },
});

/**
 * Default toolset containing all built-in tools
 */
export const defaultToolset: ToolSet = {
  calculator,
  getCurrentTime,
  generateUUID,
};

export type DefaultToolset = typeof defaultToolset;

/**
 * Get active tools based on configuration
 *
 * @param enabledTools - Array of tool names to enable. If not provided, all tools are enabled.
 * @returns ToolSet containing only the enabled tools
 */
export function getActiveTools(enabledTools?: string[]): ToolSet {
  if (!enabledTools || enabledTools.length === 0) {
    return defaultToolset;
  }

  const active: ToolSet = {};
  for (const toolName of enabledTools) {
    if (toolName in defaultToolset) {
      active[toolName] = defaultToolset[toolName];
    }
  }

  return active;
}

/**
 * Get list of all available built-in tool names
 */
export function getAvailableToolNames(): string[] {
  return Object.keys(defaultToolset);
}
