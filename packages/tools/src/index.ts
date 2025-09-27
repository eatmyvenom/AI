import type { ToolSet } from 'ai';

// Placeholder registry. Add real tools by extending this object with AI SDK tool definitions.
export const defaultToolset: ToolSet = {};

export type DefaultToolset = typeof defaultToolset;

export function getActiveTools(): ToolSet {
  return defaultToolset;
}
