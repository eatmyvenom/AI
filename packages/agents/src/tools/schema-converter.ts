/**
 * JSON Schema to Zod converter
 *
 * Converts OpenAI-style JSON Schema definitions to Zod schemas for use with AI SDK.
 */

import { z } from 'zod';

import type { JSONSchemaProperty, OpenAIFunctionParameters } from './types';

/**
 * Convert a JSON Schema property to a Zod schema
 */
export function jsonSchemaPropertyToZod(property: JSONSchemaProperty): z.ZodType {
  switch (property.type) {
    case 'string': {
      let schema = z.string();
      if (property.description) {
        schema = schema.describe(property.description);
      }
      if (property.enum && property.enum.length > 0) {
        // Create enum schema
        const [first, ...rest] = property.enum;
        return z.enum([first, ...rest] as [string, ...string[]]).describe(property.description || '');
      }
      return schema;
    }

    case 'number': {
      let schema = z.number();
      if (property.description) {
        schema = schema.describe(property.description);
      }
      if (property.minimum !== undefined) {
        schema = schema.min(property.minimum);
      }
      if (property.maximum !== undefined) {
        schema = schema.max(property.maximum);
      }
      return schema;
    }

    case 'integer': {
      let schema = z.number().int();
      if (property.description) {
        schema = schema.describe(property.description);
      }
      if (property.minimum !== undefined) {
        schema = schema.min(property.minimum);
      }
      if (property.maximum !== undefined) {
        schema = schema.max(property.maximum);
      }
      return schema;
    }

    case 'boolean': {
      let schema = z.boolean();
      if (property.description) {
        schema = schema.describe(property.description);
      }
      return schema;
    }

    case 'array': {
      let schema = z.array(property.items ? jsonSchemaPropertyToZod(property.items) : z.unknown());
      if (property.description) {
        schema = schema.describe(property.description);
      }
      return schema;
    }

    case 'object': {
      if (!property.properties) {
        return z.object({}).describe(property.description || '');
      }

      const shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries(property.properties)) {
        let fieldSchema = jsonSchemaPropertyToZod(value);

        // Make optional if not in required array
        if (!property.required || !property.required.includes(key)) {
          fieldSchema = fieldSchema.optional();
        }

        shape[key] = fieldSchema;
      }

      let schema = z.object(shape);
      if (property.description) {
        schema = schema.describe(property.description);
      }
      return schema;
    }

    default: {
      // Fallback to unknown for unsupported types
      return z.unknown();
    }
  }
}

/**
 * Convert OpenAI function parameters (JSON Schema) to Zod object schema
 */
export function convertFunctionParametersToZod(parameters: OpenAIFunctionParameters): z.ZodObject<Record<string, z.ZodType>> {
  if (!parameters.properties) {
    return z.object({});
  }

  const shape: Record<string, z.ZodType> = {};

  for (const [key, property] of Object.entries(parameters.properties)) {
    let fieldSchema = jsonSchemaPropertyToZod(property);

    // Make optional if not in required array
    if (!parameters.required || !parameters.required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Validate that a JSON Schema is supported by our converter
 */
export function validateJsonSchema(parameters: OpenAIFunctionParameters): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (parameters.type !== 'object') {
    errors.push('Root parameter type must be "object"');
  }

  if (!parameters.properties) {
    return { valid: errors.length === 0, errors };
  }

  // Recursively validate properties
  function validateProperty(property: JSONSchemaProperty, path: string): void {
    if (!['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(property.type)) {
      errors.push(`Unsupported type "${property.type}" at ${path}`);
    }

    if (property.type === 'array' && property.items) {
      validateProperty(property.items, `${path}[]`);
    }

    if (property.type === 'object' && property.properties) {
      for (const [key, value] of Object.entries(property.properties)) {
        validateProperty(value, `${path}.${key}`);
      }
    }
  }

  for (const [key, property] of Object.entries(parameters.properties)) {
    validateProperty(property, key);
  }

  return { valid: errors.length === 0, errors };
}
