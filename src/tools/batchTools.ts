import { z } from 'zod';
import { handleBatchTools } from './batchDispatcher.js';

/**
 * Schema for batch_tools - generic dispatcher for batching ANY tool operations
 */
export const BatchToolsSchema = {
    operations: z.array(z.object({
        tool: z.string().describe('Tool name (e.g., "read_file", "exec_cli", "create_directory")'),
        args: z.record(z.any()).describe('Tool-specific arguments as key-value pairs'),
        label: z.string().optional().describe('Optional label for tracking this operation in results')
    })).describe('Array of tool operations to execute. Each operation specifies a tool name and its arguments.'),

    executionMode: z.enum(['parallel', 'sequential']).optional()
        .describe('Execution mode: "parallel" (default, all ops run concurrently) or "sequential" (ops run one after another)'),

    stopOnError: z.boolean().optional()
        .describe('Stop on first error in sequential mode. Default: false (continue on errors). Ignored in parallel mode.'),

    timeout: z.number().optional()
        .describe('Per-operation timeout in milliseconds. Default: 30000ms (30 seconds)'),

    safetyLimits: z.object({
        maxOperations: z.number().optional()
            .describe('Override max operations per batch (default: 50)'),
        maxAggregateChars: z.number().optional()
            .describe('Override max aggregate output size (default: 200000 chars)'),
        maxLinesPerFile: z.number().optional()
            .describe('Override max lines per file read (default: 500 lines)')
    }).optional().describe('Override default safety limits for this batch. Configure globally in ~/.mcp/config.json')
};

// Re-export handler
export { handleBatchTools };
