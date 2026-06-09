#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionEnum, getToolsByCategory, validateToolName, getToolDefinition } from './tools/actionEnum.js';

// Helper to convert Zod schema objects to JSON Schema
function toJsonSchema(schemaObj: Record<string, z.ZodTypeAny>, required?: string[]): Record<string, unknown> {
    const zodSchema = z.object(schemaObj);
    const jsonSchema = zodToJsonSchema(zodSchema, { target: 'openApi3' }) as Record<string, unknown>;
    // Remove the $schema property if present as MCP doesn't need it
    if (jsonSchema && typeof jsonSchema === 'object') {
        delete jsonSchema['$schema'];
        // Override required if specified
        if (required) {
            jsonSchema['required'] = required;
        }
    }
    return jsonSchema;
}

const server = new Server(
    {
        name: 'mnehmos.ooda.mcp',
        version: '1.0.6',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = Object.values(ActionEnum).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool.inputSchema, tool.requiredFields)
    }));
    
    return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
        throw new Error('No arguments provided');
    }

    const toolDef = getToolDefinition(name);
    if (!toolDef) {
        throw new Error(`Unknown tool: ${name}. Available tools: ${Object.keys(ActionEnum).join(', ')}`);
    }

    return toolDef.handler(args);
});

async function main() {
    try {
        // Initialize database
        const { getDb } = await import('./storage/db.js');
        await getDb();

        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('MCP OODA Computer Server v1.0.6 running on stdio');
        console.error('Tools: CLI, CRUD, Filesystem, Screen, Input, Window, Clipboard, System, Browser, Sessions');
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
