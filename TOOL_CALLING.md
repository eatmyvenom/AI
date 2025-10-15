# Tool Calling Guide

This guide explains how to use tool calling with the OpenAI-compatible API, including both built-in server-side tools and client-provided tools.

## Overview

The API supports two types of tools:

1. **Built-in Server-Side Tools**: Pre-defined tools that execute on the server (e.g., `calculator`, `getCurrentTime`, `generateUUID`)
2. **Client-Provided Tools**: Custom tools defined in the request that execute on the client side

## Built-in Server-Side Tools

### Available Tools

#### `calculator`
Evaluates mathematical expressions safely.

**Parameters:**
- `expression` (string, required): Mathematical expression to evaluate

**Example:**
```json
{
  "model": "openai:gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "Calculate 25 * 4 + 10"}
  ]
}
```

#### `getCurrentTime`
Returns current date and time in various formats.

**Parameters:**
- `timezone` (string, optional): Timezone (e.g., "America/New_York", "Europe/London"). Defaults to UTC.
- `format` (enum, optional): Output format: "iso", "unix", "human", or "all". Defaults to "all".

**Example:**
```json
{
  "model": "openai:gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "What time is it in New York?"}
  ]
}
```

#### `generateUUID`
Generates unique identifiers (UUID v4).

**Parameters:**
- `count` (integer, optional): Number of UUIDs to generate (1-100). Defaults to 1.
- `format` (enum, optional): Output format: "string" or "array". Defaults to "string" for count=1, "array" otherwise.

**Example:**
```json
{
  "model": "openai:gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "Generate 5 unique identifiers"}
  ]
}
```

### Enabling/Disabling Built-in Tools

By default, all built-in tools are available. You can control which tools are enabled using the `enabled_builtin_tools` parameter:

```json
{
  "model": "openai:gpt-4o-mini",
  "enabled_builtin_tools": ["calculator", "getCurrentTime"],
  "messages": [
    {"role": "user", "content": "Calculate 100 / 5"}
  ]
}
```

To disable all built-in tools, pass an empty array:
```json
{
  "enabled_builtin_tools": []
}
```

## Client-Provided Tools

Client-provided tools follow the OpenAI function calling format. The model will generate tool_calls that the client must execute and return results for.

### Basic Usage

```json
{
  "model": "openai:gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "What's the weather in San Francisco?"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city and state, e.g. San Francisco, CA"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"]
            }
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

### Multi-Turn Conversation with Tool Results

1. **Initial Request**: User asks a question
2. **Model Response**: Model returns tool_calls
3. **Client Executes**: Client executes the tools
4. **Follow-up Request**: Client sends tool results back
5. **Final Response**: Model uses results to generate answer

**Example Flow:**

```bash
# Step 1: Initial request
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "openai:gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is the weather in SF?"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }]
  }'

# Response includes tool_calls:
# {
#   "choices": [{
#     "message": {
#       "role": "assistant",
#       "content": null,
#       "tool_calls": [{
#         "id": "call_abc123",
#         "type": "function",
#         "function": {
#           "name": "get_weather",
#           "arguments": "{\"location\":\"San Francisco, CA\"}"
#         }
#       }]
#     },
#     "finish_reason": "tool_calls"
#   }]
# }

# Step 2: Send tool results
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "openai:gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "What is the weather in SF?"},
      {
        "role": "assistant",
        "content": null,
        "tool_calls": [{
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"location\":\"San Francisco, CA\"}"
          }
        }]
      },
      {
        "role": "tool",
        "content": "{\"temperature\":72,\"condition\":\"sunny\"}",
        "tool_call_id": "call_abc123"
      }
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }]
  }'

# Response includes final answer:
# {
#   "choices": [{
#     "message": {
#       "role": "assistant",
#       "content": "The weather in San Francisco is currently sunny with a temperature of 72°F."
#     },
#     "finish_reason": "stop"
#   }]
# }
```

## Tool Choice

Control which tools the model can use with the `tool_choice` parameter:

- `"auto"` (default): Model decides whether to use tools
- `"none"`: Model will not use any tools
- `"required"`: Model must use at least one tool
- `{"type": "function", "function": {"name": "tool_name"}}`: Force specific tool

**Example:**
```json
{
  "model": "openai:gpt-4o-mini",
  "messages": [{"role": "user", "content": "Calculate 10 + 5"}],
  "tool_choice": {
    "type": "function",
    "function": {"name": "calculator"}
  }
}
```

## Parallel Tool Calls

By default, the model can make multiple tool calls in parallel. Control this with `parallel_tool_calls`:

```json
{
  "model": "openai:gpt-4o-mini",
  "parallel_tool_calls": false,
  "messages": [
    {"role": "user", "content": "What's the time and calculate 5+5?"}
  ]
}
```

## Mixing Built-in and Client Tools

You can use both built-in and client-provided tools in the same request:

```json
{
  "model": "openai:gpt-4o-mini",
  "messages": [
    {"role": "user", "content": "Get the weather and tell me the current time"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather information",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

In this case:
- Built-in tool `getCurrentTime` will execute on the server
- Client tool `get_weather` will be called but requires client-side execution

**Note:** If a client-provided tool has the same name as a built-in tool, the client tool takes precedence.

## Supported JSON Schema Types

For client-provided tools, the following JSON Schema types are supported:

- `string` (with optional `enum`)
- `number` (with optional `minimum`, `maximum`)
- `integer` (with optional `minimum`, `maximum`)
- `boolean`
- `array` (with `items`)
- `object` (with nested `properties`)

**Example with Complex Schema:**
```json
{
  "type": "function",
  "function": {
    "name": "search_products",
    "description": "Search for products",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query"
        },
        "filters": {
          "type": "object",
          "properties": {
            "category": {"type": "string"},
            "min_price": {"type": "number", "minimum": 0},
            "max_price": {"type": "number", "minimum": 0},
            "in_stock": {"type": "boolean"}
          }
        },
        "tags": {
          "type": "array",
          "items": {"type": "string"}
        }
      },
      "required": ["query"]
    }
  }
}
```

## Streaming with Tools

Tool calls are streamed incrementally in the same format as content:

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "openai:gpt-4o-mini",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Calculate 10 + 5"}
    ]
  }'

# Stream output (simplified):
# data: {"choices":[{"delta":{"role":"assistant"}}]}
# data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"calculator","arguments":""}}]}}]}
# data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"ex"}}]}}]}
# data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"pression\":\"10 + 5\"}"}}]}}]}
# data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
# data: [DONE]
```

## Error Handling

### Invalid Tool Schema
If a client-provided tool has an invalid schema, it will be skipped and logged:
```json
{
  "error": {
    "message": "Invalid JSON Schema for tool 'bad_tool': Unsupported type 'null' at parameter",
    "type": "invalid_request_error"
  }
}
```

### Missing Tool Definition
If tool results reference a tool that wasn't defined:
```json
{
  "error": {
    "message": "Tool 'unknown_tool' not found in available tools",
    "type": "invalid_request_error"
  }
}
```

## Best Practices

1. **Clear Descriptions**: Provide detailed descriptions for tools and parameters
2. **Appropriate Types**: Use the most specific type (e.g., `integer` instead of `number` for counts)
3. **Required Fields**: Mark fields as required when they're essential
4. **Error Handling**: Handle tool execution errors gracefully on the client side
5. **Tool Selection**: Use `enabled_builtin_tools` to limit which built-in tools are available
6. **Conversation State**: Maintain full conversation history including tool calls and results

## Testing

Use the provided test script to verify tool calling:

```bash
./test-tools.sh
```

This script tests:
- Built-in calculator tool
- Built-in getCurrentTime tool
- Built-in generateUUID tool
- Selective tool enabling
- Client-provided tools
- Mixed built-in and client tools

## Troubleshooting

### Tools not being called
- Check tool descriptions are clear and relevant to the user query
- Verify `tool_choice` is not set to `"none"`
- Ensure tool names don't contain special characters

### Schema validation errors
- Verify your JSON Schema follows the supported types
- Check that `required` fields are listed correctly
- Use simple types when possible

### Tool results not working
- Ensure `tool_call_id` matches the original tool call
- Verify the tool result message has `role: "tool"`
- Include the tool definition in follow-up requests

## Additional Resources

- [OpenAI Function Calling Documentation](https://platform.openai.com/docs/guides/function-calling)
- [JSON Schema Reference](https://json-schema.org/understanding-json-schema/)
- See `RUNBOOK.md` for deployment and configuration
- See `AGENTS.md` for agent architecture details
