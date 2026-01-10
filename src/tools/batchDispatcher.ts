import { getBatchSafetyLimits } from '../config.js';
import { logAudit } from '../audit.js';
import * as cliTools from './cli.js';
import * as crudTools from './crud.js';
import * as filesystemTools from './filesystem.js';
import * as screenTools from './screen.js';
import * as inputTools from './input.js';
import * as windowTools from './window.js';
import * as clipboardTools from './clipboard.js';
import * as systemTools from './system.js';
import * as diffTools from './diff/index.js';
import * as sessionTools from './sessions.js';
import * as configTools from './configTools.js';
import * as analyticsTools from './analytics.js';
import * as executeCodeTools from './executeCode.js';

// Tool Registry - maps tool name to handler function
// NOTE: Batch tools are excluded to avoid recursion
type ToolHandler = (args: any) => Promise<any>;
const TOOL_REGISTRY = new Map<string, ToolHandler>([
    // CLI Tools (non-batch)
    ['exec_cli', cliTools.handleExecCli],
    ['read_file', cliTools.handleReadFile],
    ['write_file', cliTools.handleWriteFile],
    ['list_directory', cliTools.handleListDirectory],
    ['str_replace', cliTools.handleStrReplace],
    ['read_file_lines', cliTools.handleReadFileLines],
    ['search_in_file', cliTools.handleSearchInFile],

    // CRUD Tools (non-batch)
    ['crud_create', crudTools.handleCrudCreate],
    ['crud_read', crudTools.handleCrudRead],
    ['crud_update', crudTools.handleCrudUpdate],
    ['crud_delete', crudTools.handleCrudDelete],
    ['crud_query', crudTools.handleCrudQuery],

    // Filesystem Tools (non-batch)
    ['copy_file', filesystemTools.handleCopyFile],
    ['move_file', filesystemTools.handleMoveFile],
    ['delete_file', filesystemTools.handleDeleteFile],
    ['file_info', filesystemTools.handleFileInfo],
    ['search_files', filesystemTools.handleSearchFiles],

    // Screen Tools
    ['screenshot', screenTools.handleScreenshot],
    ['get_screen_info', screenTools.handleGetScreenInfo],
    ['wait_for_screen_change', screenTools.handleWaitForScreenChange],
    ['find_on_screen', screenTools.handleFindOnScreen],

    // Input Tools (non-batch)
    ['keyboard_type', inputTools.handleKeyboardType],
    ['keyboard_press', inputTools.handleKeyboardPress],
    ['keyboard_shortcut', inputTools.handleKeyboardShortcut],
    ['mouse_move', inputTools.handleMouseMove],
    ['mouse_click', inputTools.handleMouseClick],
    ['mouse_drag', inputTools.handleMouseDrag],
    ['mouse_scroll', inputTools.handleMouseScroll],
    ['get_mouse_position', inputTools.handleGetMousePosition],

    // Window Tools
    ['list_windows', windowTools.handleListWindows],
    ['get_active_window', windowTools.handleGetActiveWindow],
    ['focus_window', windowTools.handleFocusWindow],
    ['minimize_window', windowTools.handleMinimizeWindow],
    ['maximize_window', windowTools.handleMaximizeWindow],
    ['restore_window', windowTools.handleRestoreWindow],
    ['close_window', windowTools.handleCloseWindow],
    ['resize_window', windowTools.handleResizeWindow],
    ['move_window', windowTools.handleMoveWindow],
    ['launch_application', windowTools.handleLaunchApplication],
    ['wait_for_window', windowTools.handleWaitForWindow],

    // Clipboard Tools
    ['clipboard_read', clipboardTools.handleClipboardRead],
    ['clipboard_write', clipboardTools.handleClipboardWrite],
    ['clipboard_clear', clipboardTools.handleClipboardClear],
    ['clipboard_has_format', clipboardTools.handleClipboardHasFormat],

    // System Tools
    ['get_system_info', systemTools.handleGetSystemInfo],
    ['list_processes', systemTools.handleListProcesses],
    ['kill_process', systemTools.handleKillProcess],
    ['get_environment', systemTools.handleGetEnvironment],
    ['set_environment', systemTools.handleSetEnvironment],
    ['get_network_info', systemTools.handleGetNetworkInfo],
    ['wait', systemTools.handleWait],
    ['notify', systemTools.handleNotify],

    // Diff Editing Tools
    ['edit_block', diffTools.handleEditBlock],
    ['apply_diff', diffTools.handleApplyDiff],
    ['get_diff_preview', diffTools.handleGetDiffPreview],
    ['batch_edit_blocks', diffTools.handleBatchEditBlocksMcp],
    ['write_from_line', diffTools.handleWriteFromLineMcp],

    // Interactive Process Sessions
    ['start_process', sessionTools.handleStartProcess],
    ['interact_with_process', sessionTools.handleInteractWithProcess],
    ['read_process_output', sessionTools.handleReadProcessOutput],
    ['list_sessions', sessionTools.handleListSessions],
    ['terminate_process', sessionTools.handleTerminateProcess],

    // Configuration Management
    ['get_config', configTools.handleGetConfig],
    ['set_config_value', configTools.handleSetConfigValue],
    ['reset_config', configTools.handleResetConfig],

    // Analytics and Usage Stats
    ['get_usage_stats', analyticsTools.handleGetUsageStats],
    ['get_recent_tool_calls', analyticsTools.handleGetRecentToolCalls],
    ['get_audit_log_stats', analyticsTools.handleGetAuditLogStats],
    ['clear_old_logs', analyticsTools.handleClearOldLogs],

    // Execute Code
    ['execute_code', executeCodeTools.handleExecuteCode],
]);

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
     * Apply per-operation limits (e.g., truncate file reads)
     */
    static enforcePerOperationLimit(result: any, toolName: string, limits: any): any {
        // Truncate file read operations
        if (toolName === 'read_file' && result?.content) {
            const lines = result.content.split('\n');
            if (lines.length > limits.maxLinesPerFile) {
                result.content = lines.slice(0, limits.maxLinesPerFile).join('\n');
                result.truncated = true;
                result.totalLines = lines.length;
                result.shownLines = limits.maxLinesPerFile;
                result.warning = `Truncated at ${limits.maxLinesPerFile} of ${lines.length} lines`;
            }
        }
        return result;
    }

    /**
     * Check aggregate size across all results and generate warnings
     */
    static checkAggregateSize(results: BatchOperationResult[], limits: any): string[] {
        const totalChars = results
            .filter(r => r.success && r.result)
            .reduce((sum, r) => {
                const content = typeof r.result === 'string'
                    ? r.result
                    : JSON.stringify(r.result);
                return sum + content.length;
            }, 0);

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
    const handler = TOOL_REGISTRY.get(tool);
    if (!handler) {
        throw new Error(
            `Unknown tool: ${tool}. Available tools: ${Array.from(TOOL_REGISTRY.keys()).slice(0, 10).join(', ')}...`
        );
    }

    // Race between handler execution and timeout
    return await Promise.race([
        handler(args),
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
                let result = await dispatchToolCall(op.tool, op.args, timeout);

                // Apply per-operation safety limits (truncation, etc.)
                result = SafetyEnforcer.enforcePerOperationLimit(result, op.tool, limits);

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
                let result = await dispatchToolCall(op.tool, op.args, timeout);

                // Apply per-operation safety limits
                result = SafetyEnforcer.enforcePerOperationLimit(result, op.tool, limits);

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

    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                summary: {
                    total: args.operations.length,
                    successful,
                    failed,
                    elapsed_ms: elapsed,
                    executionMode,
                    warnings
                },
                results: results.sort((a, b) => a.index - b.index)
            }, null, 2)
        }],
        isError: failed > 0 && successful === 0,
    };
}
