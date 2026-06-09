import { getBatchSafetyLimits } from '../config.js';
import { logAudit } from '../audit.js';
import { ActionEnum, getToolDefinition } from './actionEnum.js';

interface ToolOperation {
    tool: string;
    args: Record<string, any>;
    label?: string;
}

interface BatchToolsArgs {
    operations: ToolOperation[];
    executionMode?: 'parallel' | 'sequential';
    stopOnError?: boolean;
    timeout?: number;
    safetyLimits?: {
        maxOperations?: number;
        maxAggregateChars?: number;
        maxLinesPerFile?: number;
    };
}

interface BatchOperationResult {
    index: number;
    tool: string;
    label?: string;
    success: boolean;
    result?: any;
    error?: string;
    truncated?: boolean;
}

/**
 * Safety enforcement for batch operations
 */
class SafetyEnforcer {
    /**
     * Validate that batch size is within limits
     */
    static validateBatchSize(operations: ToolOperation[], limits: any): void {
        if (operations.length > limits.maxOperations) {
            throw new Error(
                `Batch size ${operations.length} exceeds limit ${limits.maxOperations}. ` +
                `Adjust via ~/.mcp/config.json batchOperations.maxOperations`
            );
        }
    }

    /**
     * Extract text content from a tool result in a type-safe way.
     * MCP results have shape: { content: Array<{type: 'text', text: string}> }
     * This utility handles that shape correctly without assuming the old
     * (incorrect) shape where content was a plain string.
     */
    static extractText(result: any): string {
        if (!result) return '';
        if (typeof result === 'string') return result;
        if (Array.isArray(result.content)) {
            return result.content
                .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
                .join('');
        }
        // Fallback for unexpected shapes — stringify as a last resort.
        try {
            return JSON.stringify(result);
        } catch {
            return String(result);
        }
    }

    /**
     * Check aggregate size across all results and generate warnings.
     * Previously stringified entire result objects which inflated counts with
     * MCP protocol overhead. Now extracts actual text content.
     */
    static checkAggregateSize(results: BatchOperationResult[], limits: any): string[] {
        const totalChars = results
            .filter(r => r.success && r.result)
            .reduce((sum, r) => sum + SafetyEnforcer.extractText(r.result).length, 0);

        const warnings = [];
        if (totalChars > limits.maxAggregateChars) {
            warnings.push(
                `⚠️  Aggregate output size ${totalChars} chars exceeds recommended limit ${limits.maxAggregateChars}. ` +
                `Consider reducing batch size or filtering output.`
            );
        }
        return warnings;
    }
}

/**
 * Dispatch a single tool call with timeout protection
 */
async function dispatchToolCall(
    tool: string,
    args: any,
    timeout: number
): Promise<any> {
    const toolDef = getToolDefinition(tool);
    if (!toolDef) {
        throw new Error(
            `Unknown tool: ${tool}. Available tools: ${Object.keys(ActionEnum).filter(name => name !== 'batch_tools').slice(0, 10).join(', ')}...`
        );
    }

    // Race between handler execution and timeout
    return await Promise.race([
        toolDef.handler(args),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
        )
    ]);
}

/**
 * Main batch tools handler - executes multiple tool operations in parallel or sequential mode
 */
export async function handleBatchTools(args: BatchToolsArgs) {
    const startTime = Date.now();

    // Get safety limits (global + overrides)
    const limits = getBatchSafetyLimits();

    // Override with user-provided limits if specified
    if (args.safetyLimits) {
        Object.assign(limits, args.safetyLimits);
    }

    // Validate batch size before execution
    SafetyEnforcer.validateBatchSize(args.operations, limits);

    const executionMode = args.executionMode || 'parallel';
    const stopOnError = args.stopOnError ?? false;
    const timeout = args.timeout || limits.timeout;

    const results: BatchOperationResult[] = [];

    if (executionMode === 'parallel') {
        // Parallel execution - all operations run concurrently
        const promises = args.operations.map(async (op, index) => {
            try {
                const result = await dispatchToolCall(op.tool, op.args, timeout);

                // Per-operation limits (e.g. read_file truncation) are enforced
                // by individual handlers themselves. The previous implementation
                // tried to re-enforce them here by splitting on newlines, which
                // crashed on MCP's array-of-content-blocks return shape. Removed.

                // MCP convention: handlers signal failure via { isError: true }
                // rather than throwing. We honor that here so stopOnError and
                // the success/fail counts reflect real outcomes.
                if (result && (result as any).isError) {
                    const errText = SafetyEnforcer.extractText(result) || 'Tool reported error';
                    return {
                        index,
                        tool: op.tool,
                        label: op.label,
                        success: false,
                        error: errText,
                        result
                    };
                }

                return {
                    index,
                    tool: op.tool,
                    label: op.label,
                    success: true,
                    result
                };
            } catch (error: any) {
                return {
                    index,
                    tool: op.tool,
                    label: op.label,
                    success: false,
                    error: error.message
                };
            }
        });

        results.push(...await Promise.all(promises));

    } else {
        // Sequential execution - operations run one after another
        for (let index = 0; index < args.operations.length; index++) {
            const op = args.operations[index];
            try {
                const result = await dispatchToolCall(op.tool, op.args, timeout);

                // Per-operation limits enforced by individual handlers (see above).

                // MCP convention: handlers signal failure via { isError: true }
                // rather than throwing. Honor that so stopOnError works.
                if (result && (result as any).isError) {
                    const errText = SafetyEnforcer.extractText(result) || 'Tool reported error';
                    results.push({
                        index,
                        tool: op.tool,
                        label: op.label,
                        success: false,
                        error: errText,
                        result
                    });
                    if (stopOnError) break;
                    continue;
                }

                results.push({
                    index,
                    tool: op.tool,
                    label: op.label,
                    success: true,
                    result
                });
            } catch (error: any) {
                results.push({
                    index,
                    tool: op.tool,
                    label: op.label,
                    success: false,
                    error: error.message
                });

                // Stop on error if requested (sequential mode only)
                if (stopOnError) {
                    break;
                }
            }
        }
    }

    // Check aggregate size and generate warnings
    const warnings = SafetyEnforcer.checkAggregateSize(results, limits);

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const elapsed = Date.now() - startTime;

    // Log audit trail
    await logAudit('batch_tools', {
        count: args.operations.length,
        executionMode,
        stopOnError
    }, {
        successful,
        failed,
        elapsed
    });

    // Format results in markdown for better readability
    let markdownOutput = `## Batch Operations Summary\n\n`;
    markdownOutput += `**Execution Mode:** ${executionMode}\n`;
    markdownOutput += `**Total Operations:** ${args.operations.length}\n`;
    markdownOutput += `**Successful:** ${successful}\n`;
    markdownOutput += `**Failed:** ${failed}\n`;
    markdownOutput += `**Elapsed Time:** ${elapsed}ms\n\n`;
    
    if (warnings.length > 0) {
        markdownOutput += `### ⚠️ Warnings\n`;
        warnings.forEach(warning => {
            markdownOutput += `- ${warning}\n`;
        });
        markdownOutput += `\n`;
    }
    
    markdownOutput += `### Detailed Results\n\n`;
    
    const sortedResults = results.sort((a, b) => a.index - b.index);
    sortedResults.forEach(result => {
        const indexStr = `**${result.index + 1}.** `;
        const toolStr = `\`${result.tool}\``;
        const labelStr = result.label ? ` (${result.label})` : '';
        
        if (result.success) {
            markdownOutput += `${indexStr}${toolStr}${labelStr} - ✅ Success\n`;
            if (result.result) {
                const resultStr = typeof result.result === 'string' 
                    ? result.result 
                    : JSON.stringify(result.result, null, 2);
                markdownOutput += `\`\`\`\n${resultStr}\n\`\`\`\n`;
            }
            if (result.truncated) {
                markdownOutput += `⚠️ Output truncated\n`;
            }
        } else {
            markdownOutput += `${indexStr}${toolStr}${labelStr} - ❌ Failed\n`;
            if (result.error) {
                markdownOutput += `**Error:** ${result.error}\n`;
            }
        }
        markdownOutput += `\n`;
    });
    
    return {
        content: [{
            type: 'text',
            text: markdownOutput
        }],
        isError: failed > 0 && successful === 0,
    };
}
