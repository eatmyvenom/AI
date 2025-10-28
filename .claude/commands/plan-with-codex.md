---
description: "Create a detailed implementation plan using Codex before executing"
---

# Plan with Codex

Enter Plan Mode and use the Codex planner MCP tool to analyze requirements and create a comprehensive implementation plan.

## Task Description

$ARGUMENTS

## Planning Instructions

Use the `@codex-planner` MCP tool to create a detailed implementation plan that includes:

### 1. Files Analysis
- All files that need to be created
- All files that need to be modified
- Current state of relevant files

### 2. Implementation Sequence
- Step-by-step implementation order
- Dependencies between steps
- Reasoning for the sequence

### 3. Edge Cases & Error Handling
- Potential edge cases to consider
- Error handling strategies
- Validation requirements

### 4. Testing Approach
- Unit tests to write
- Integration tests needed
- Manual testing checklist

### 5. Risk Assessment
- Potential risks and mitigations
- Breaking changes (if any)
- Rollback strategy

### 6. Complexity Estimate
- Time estimate
- Complexity rating (low/medium/high)
- Required expertise level

## Workflow

1. Analyze the codebase using `@codex-planner`
2. Generate the comprehensive plan
3. Present the plan to the user
4. **Wait for explicit approval before proceeding**
5. Only after approval, use `@codex-actor` to implement

## Note

This command automatically enters Plan Mode (read-only). Do not make any changes until the plan is approved.
