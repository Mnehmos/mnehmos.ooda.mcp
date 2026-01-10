#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

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

// CLI Tools
import {
    handleExecCli, ExecCliSchema,
    handleReadFile, ReadFileSchema,
    handleWriteFile, WriteFileSchema,
    handleListDirectory, ListDirectorySchema,
    handleStrReplace, StrReplaceSchema,
    handleReadFileLines, ReadFileLinesSchema,
    handleSearchInFile, SearchInFileSchema,
    handleBatchExecCli, BatchExecCliSchema,
    handleBatchReadFiles, BatchReadFilesSchema,
    handleBatchWriteFiles, BatchWriteFilesSchema,
    handleBatchListDirectories, BatchListDirectoriesSchema,
    handleBatchStrReplace, BatchStrReplaceSchema,
    handleBatchSearchInFiles, BatchSearchInFilesSchema
} from './tools/cli.js';

// CRUD Tools
import {
    handleCrudCreate, CrudCreateSchema,
    handleCrudRead, CrudReadSchema,
    handleCrudUpdate, CrudUpdateSchema,
    handleCrudDelete, CrudDeleteSchema,
    handleCrudQuery, CrudQuerySchema,
    handleCrudBatchCreate, CrudBatchCreateSchema,
    handleCrudBatchRead, CrudBatchReadSchema,
    handleCrudBatchUpdate, CrudBatchUpdateSchema,
    handleCrudBatchDelete, CrudBatchDeleteSchema
} from './tools/crud.js';

// Filesystem Tools
import {
    handleCopyFile, CopyFileSchema,
    handleMoveFile, MoveFileSchema,
    handleDeleteFile, DeleteFileSchema,
    handleFileInfo, FileInfoSchema,
    handleSearchFiles, SearchFilesSchema,
    handleBatchCopyFiles, BatchCopyFilesSchema,
    handleBatchMoveFiles, BatchMoveFilesSchema,
    handleBatchDeleteFiles, BatchDeleteFilesSchema,
    handleBatchFileInfo, BatchFileInfoSchema
} from './tools/filesystem.js';

// Screen Tools
import {
    handleScreenshot, ScreenshotSchema,
    handleGetScreenInfo, GetScreenInfoSchema,
    handleWaitForScreenChange, WaitForScreenChangeSchema,
    handleFindOnScreen, FindOnScreenSchema
} from './tools/screen.js';

// Input Tools
import {
    handleKeyboardType, KeyboardTypeSchema,
    handleKeyboardPress, KeyboardPressSchema,
    handleKeyboardShortcut, KeyboardShortcutSchema,
    handleMouseMove, MouseMoveSchema,
    handleMouseClick, MouseClickSchema,
    handleMouseDrag, MouseDragSchema,
    handleMouseScroll, MouseScrollSchema,
    handleGetMousePosition, GetMousePositionSchema,
    handleBatchKeyboardActions, BatchKeyboardActionsSchema,
    handleBatchMouseActions, BatchMouseActionsSchema
} from './tools/input.js';

// Window Tools
import {
    handleListWindows, ListWindowsSchema,
    handleGetActiveWindow, GetActiveWindowSchema,
    handleFocusWindow, FocusWindowSchema,
    handleMinimizeWindow, MinimizeWindowSchema,
    handleMaximizeWindow, MaximizeWindowSchema,
    handleRestoreWindow, RestoreWindowSchema,
    handleCloseWindow, CloseWindowSchema,
    handleResizeWindow, ResizeWindowSchema,
    handleMoveWindow, MoveWindowSchema,
    handleLaunchApplication, LaunchApplicationSchema,
    handleWaitForWindow, WaitForWindowSchema
} from './tools/window.js';

// Clipboard Tools
import {
    handleClipboardRead, ClipboardReadSchema,
    handleClipboardWrite, ClipboardWriteSchema,
    handleClipboardClear, ClipboardClearSchema,
    handleClipboardHasFormat, ClipboardHasFormatSchema
} from './tools/clipboard.js';

// System Tools
import {
    handleGetSystemInfo, GetSystemInfoSchema,
    handleListProcesses, ListProcessesSchema,
    handleKillProcess, KillProcessSchema,
    handleGetEnvironment, GetEnvironmentSchema,
    handleSetEnvironment, SetEnvironmentSchema,
    handleGetNetworkInfo, GetNetworkInfoSchema,
    handleWait, WaitSchema,
    handleNotify, NotifySchema
} from './tools/system.js';

// Diff Editing Tools
import {
    handleEditBlock, EditBlockSchema,
    handleApplyDiff, ApplyDiffSchema,
    handleGetDiffPreview, GetDiffPreviewSchema,
    handleBatchEditBlocks, BatchEditBlocksSchema,
    handleWriteFromLine, WriteFromLineSchema
} from './tools/diff/index.js';

// Generic Batch Tools
import {
    handleBatchTools, BatchToolsSchema
} from './tools/batchTools.js';

// Interactive Process Sessions
import {
    handleStartProcess, StartProcessSchema,
    handleInteractWithProcess, InteractWithProcessSchema,
    handleReadProcessOutput, ReadProcessOutputSchema,
    handleListSessions, ListSessionsSchema,
    handleTerminateProcess, TerminateProcessSchema
} from './tools/sessions.js';

// Configuration Management
import {
    handleGetConfig, GetConfigSchema,
    handleSetConfigValue, SetConfigValueSchema,
    handleResetConfig, ResetConfigSchema
} from './tools/configTools.js';

// Analytics and Usage Stats
import {
    handleGetUsageStats, GetUsageStatsSchema,
    handleGetRecentToolCalls, GetRecentToolCallsSchema,
    handleGetAuditLogStats, GetAuditLogStatsSchema,
    handleClearOldLogs, ClearOldLogsSchema
} from './tools/analytics.js';

// Execute Code in Memory
import { handleExecuteCode, ExecuteCodeSchema } from './tools/executeCode.js';

// Paginated Search
import {
    handleStartSearch, StartSearchSchema,
    handleGetSearchResults, GetSearchResultsSchema,
    handleListSearches, ListSearchesSchema,
    handleStopSearch, StopSearchSchema
} from './tools/paginatedSearch.js';

// Browser Automation
import {
    handleLaunchBrowser, LaunchBrowserSchema,
    handleCloseBrowser, CloseBrowserSchema,
    handleNavigatePage, NavigatePageSchema,
    handleGetPageContent, GetPageContentSchema,
    handleClickElement, ClickElementSchema,
    handleTypeText, TypeTextSchema,
    handleEvalJs, EvalJsSchema,
    handleScreenshotPage, ScreenshotPageSchema,
    handleGetConsoleLogs, GetConsoleLogsSchema
} from './tools/browser/tools.js';

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
    return {
        tools: [
            // ==========================================
            // === CLI & File Operations ===
            // ==========================================
            {
                name: 'exec_cli',
                description: 'Execute shell commands on the host system (YOLO mode)',
                inputSchema: toJsonSchema(ExecCliSchema, ['command']),
            },
            {
                name: 'execute_code',
                description: 'Execute code in memory without saving to file. Supports python, node, r, powershell, bash.',
                inputSchema: toJsonSchema(ExecuteCodeSchema, ['language', 'code']),
            },
            {
                name: 'read_file',
                description: 'Read file contents. ⚠️ CONTEXT WARNING: Truncates at 500 lines. For large files or targeted access, PREFER these surgical alternatives:\n• read_file_lines - Read specific line ranges (use offset: -50 for last 50 lines)\n• search_in_file - Find patterns with context lines\n• edit_block - Search/replace without full read\nFull file reads consume context rapidly. Be surgical.',
                inputSchema: toJsonSchema(ReadFileSchema, ['path']),
            },
            {
                name: 'write_file',
                description: 'Write content to a file',
                inputSchema: toJsonSchema(WriteFileSchema, ['path', 'content']),
            },
            {
                name: 'list_directory',
                description: 'List contents of a directory',
                inputSchema: toJsonSchema(ListDirectorySchema, ['path']),
            },
            {
                name: 'str_replace',
                description: 'Replace a unique string in a file with another string. The string to replace must appear exactly once in the file.',
                inputSchema: toJsonSchema(StrReplaceSchema, ['path', 'oldText']),
            },
            {
                name: 'copy_file',
                description: 'Copy a file or directory. For multiple operations, use batch_copy_files.',
                inputSchema: toJsonSchema(CopyFileSchema, ['source', 'destination']),
            },
            {
                name: 'move_file',
                description: 'Move/rename a file or directory. For multiple operations, use batch_move_files.',
                inputSchema: toJsonSchema(MoveFileSchema, ['source', 'destination']),
            },
            {
                name: 'delete_file',
                description: 'Delete a file or directory. For multiple deletions, use batch_delete_files.',
                inputSchema: toJsonSchema(DeleteFileSchema, ['path']),
            },
            {
                name: 'file_info',
                description: 'Get file/directory metadata (size, dates, type). For multiple paths, use batch_file_info.',
                inputSchema: toJsonSchema(FileInfoSchema, ['path']),
            },
            {
                name: 'search_files',
                description: 'Search for files by pattern in a directory tree.',
                inputSchema: toJsonSchema(SearchFilesSchema, ['directory', 'pattern']),
            },
            {
                name: 'read_file_lines',
                description: 'Read specific lines from a file (token-efficient). Returns line range with optional line numbers. Use this instead of read_file when you only need a portion of a large file.',
                inputSchema: toJsonSchema(ReadFileLinesSchema, ['path']),
            },
            {
                name: 'search_in_file',
                description: 'Search for text or regex patterns within a file. Returns matching lines with optional context. More efficient than reading entire file when looking for specific content.',
                inputSchema: toJsonSchema(SearchInFileSchema, ['path', 'pattern']),
            },

            // Batch file operations
            {
                name: 'batch_exec_cli',
                description: 'Execute multiple shell commands in parallel.',
                inputSchema: toJsonSchema(BatchExecCliSchema),
            },
            {
                name: 'batch_read_files',
                description: 'Read multiple files in parallel.',
                inputSchema: toJsonSchema(BatchReadFilesSchema),
            },
            {
                name: 'batch_write_files',
                description: 'Write multiple files in parallel.',
                inputSchema: toJsonSchema(BatchWriteFilesSchema),
            },
            {
                name: 'batch_list_directories',
                description: 'List multiple directories in parallel.',
                inputSchema: toJsonSchema(BatchListDirectoriesSchema),
            },
            {
                name: 'batch_copy_files',
                description: 'Copy multiple files in parallel.',
                inputSchema: toJsonSchema(BatchCopyFilesSchema),
            },
            {
                name: 'batch_move_files',
                description: 'Move multiple files in parallel.',
                inputSchema: toJsonSchema(BatchMoveFilesSchema),
            },
            {
                name: 'batch_delete_files',
                description: 'Delete multiple files in parallel.',
                inputSchema: toJsonSchema(BatchDeleteFilesSchema),
            },
            {
                name: 'batch_file_info',
                description: 'Get info for multiple files in parallel.',
                inputSchema: toJsonSchema(BatchFileInfoSchema),
            },
            {
                name: 'batch_str_replace',
                description: 'Replace strings across multiple files in parallel. Supports replaceAll option to replace multiple occurrences per file.',
                inputSchema: toJsonSchema(BatchStrReplaceSchema),
            },
            {
                name: 'batch_search_in_files',
                description: 'Search for patterns across multiple files in parallel. Supports regex, literal, and fuzzy/approximate matching with configurable similarity threshold.',
                inputSchema: toJsonSchema(BatchSearchInFilesSchema),
            },

            // ==========================================
            // === Diff-Based Editing ===
            // ==========================================
            {
                name: 'edit_block',
                description: 'Search and replace text in a file with fuzzy matching fallback. Shows diff preview when exact match fails. Use expectedReplacements to control how many occurrences to replace. Use dryRun=true for preview only.',
                inputSchema: toJsonSchema(EditBlockSchema, ['path', 'search', 'replace']),
            },
            {
                name: 'apply_diff',
                description: 'Apply multiple search/replace operations to a file in a single atomic operation. Validates all blocks before applying any changes. Use dryRun=true for preview. Use startLine hints for faster matching in large files.',
                inputSchema: toJsonSchema(ApplyDiffSchema, ['path', 'diffs']),
            },
            {
                name: 'get_diff_preview',
                description: 'Generate a diff preview showing what changes would be made without applying them. Supports unified, inline (character-level), and side-by-side formats.',
                inputSchema: toJsonSchema(GetDiffPreviewSchema, ['path', 'search', 'replace']),
            },
            {
                name: 'batch_edit_blocks',
                description: 'Apply multiple search/replace operations to a single file sequentially. Each edit operates on the result of the previous edit. Supports partial success - completed edits are saved even if later edits fail. Use stopOnError to halt on first failure. Use dryRun for preview.',
                inputSchema: toJsonSchema(BatchEditBlocksSchema, ['path', 'edits']),
            },
            {
                name: 'write_from_line',
                description: 'Replace content starting from a specific line number. Use startLine to keep lines 1-(startLine-1) and replace from startLine to EOF (or to endLine if specified). Ideal for bulk section replacement in large files without sending entire file content.',
                inputSchema: toJsonSchema(WriteFromLineSchema, ['path', 'startLine', 'content']),
            },
            {
                name: 'batch_tools',
                description: 'Execute multiple tool operations in parallel or sequential mode. Can batch ANY tool type (read_file, exec_cli, create_directory, etc.) with unified safety limits. Each operation: {tool: "tool_name", args: {...}}. Enforces: 500 lines/file, 50 ops max, 200KB aggregate (configurable via ~/.mcp/config.json). Use executionMode="parallel" (default) for concurrent execution or "sequential" for ordered execution with stopOnError support.',
                inputSchema: toJsonSchema(BatchToolsSchema, ['operations']),
            },

            // ==========================================
            // === Interactive Process Sessions ===
            // ==========================================
            {
                name: 'start_process',
                description: 'Start a new interactive process session. Returns a sessionId for subsequent interactions. Use for long-running processes, REPLs, SSH, or any process requiring stdin/stdout interaction.',
                inputSchema: toJsonSchema(StartProcessSchema, ['command']),
            },
            {
                name: 'interact_with_process',
                description: 'Send input to a running process session. Input is written to the process stdin.',
                inputSchema: toJsonSchema(InteractWithProcessSchema, ['sessionId', 'input']),
            },
            {
                name: 'read_process_output',
                description: 'Read output from a process session. Use negative lines value to read last N lines. Use clear=true to clear the buffer after reading.',
                inputSchema: toJsonSchema(ReadProcessOutputSchema, ['sessionId']),
            },
            {
                name: 'list_sessions',
                description: 'List all active process sessions with their status and basic info.',
                inputSchema: toJsonSchema(ListSessionsSchema),
            },
            {
                name: 'terminate_process',
                description: 'Terminate a process session. Use force=true for SIGKILL instead of graceful SIGTERM.',
                inputSchema: toJsonSchema(TerminateProcessSchema, ['sessionId']),
            },

            // ==========================================
            // === CRUD Database Operations ===
            // ==========================================
            {
                name: 'crud_create',
                description: 'Create a new record in a collection',
                inputSchema: toJsonSchema(CrudCreateSchema, ['collection', 'data']),
            },
            {
                name: 'crud_read',
                description: 'Read a record by ID',
                inputSchema: toJsonSchema(CrudReadSchema, ['collection', 'id']),
            },
            {
                name: 'crud_update',
                description: 'Update an existing record',
                inputSchema: toJsonSchema(CrudUpdateSchema, ['collection', 'id', 'data']),
            },
            {
                name: 'crud_delete',
                description: 'Delete a record',
                inputSchema: toJsonSchema(CrudDeleteSchema, ['collection', 'id']),
            },
            {
                name: 'crud_query',
                description: 'Query records in a collection',
                inputSchema: toJsonSchema(CrudQuerySchema, ['collection']),
            },
            {
                name: 'crud_batch_create',
                description: 'Create multiple records in parallel.',
                inputSchema: toJsonSchema(CrudBatchCreateSchema),
            },
            {
                name: 'crud_batch_read',
                description: 'Read multiple records in parallel.',
                inputSchema: toJsonSchema(CrudBatchReadSchema),
            },
            {
                name: 'crud_batch_update',
                description: 'Update multiple records in parallel.',
                inputSchema: toJsonSchema(CrudBatchUpdateSchema),
            },
            {
                name: 'crud_batch_delete',
                description: 'Delete multiple records in parallel.',
                inputSchema: toJsonSchema(CrudBatchDeleteSchema),
            },

            // ==========================================
            // === Screen Perception (OBSERVE) ===
            // ==========================================
            {
                name: 'screenshot',
                description: 'Capture screenshot of screen or region. Returns base64 image or saves to file.',
                inputSchema: toJsonSchema(ScreenshotSchema),
            },
            {
                name: 'get_screen_info',
                description: 'Get display/monitor information (resolution, count, positions).',
                inputSchema: toJsonSchema(GetScreenInfoSchema),
            },
            {
                name: 'wait_for_screen_change',
                description: 'Wait until screen content changes in a region. Useful for detecting UI updates.',
                inputSchema: toJsonSchema(WaitForScreenChangeSchema),
            },
            {
                name: 'find_on_screen',
                description: 'Find text or image on screen (requires OCR/template matching dependencies).',
                inputSchema: toJsonSchema(FindOnScreenSchema),
            },

            // ==========================================
            // === Input Simulation (ACT) ===
            // ==========================================
            {
                name: 'keyboard_type',
                description: 'Type text as keyboard input.',
                inputSchema: toJsonSchema(KeyboardTypeSchema, ['text']),
            },
            {
                name: 'keyboard_press',
                description: 'Press a key with optional modifiers (ctrl, alt, shift).',
                inputSchema: toJsonSchema(KeyboardPressSchema, ['key']),
            },
            {
                name: 'keyboard_shortcut',
                description: 'Execute keyboard shortcut (e.g., "ctrl+c", "alt+tab").',
                inputSchema: toJsonSchema(KeyboardShortcutSchema, ['shortcut']),
            },
            {
                name: 'mouse_move',
                description: 'Move mouse cursor to coordinates.',
                inputSchema: toJsonSchema(MouseMoveSchema, ['x', 'y']),
            },
            {
                name: 'mouse_click',
                description: 'Click mouse button at position. Supports double-click.',
                inputSchema: toJsonSchema(MouseClickSchema),
            },
            {
                name: 'mouse_drag',
                description: 'Drag from one position to another.',
                inputSchema: toJsonSchema(MouseDragSchema, ['startX', 'startY', 'endX', 'endY']),
            },
            {
                name: 'mouse_scroll',
                description: 'Scroll mouse wheel.',
                inputSchema: toJsonSchema(MouseScrollSchema, ['deltaY']),
            },
            {
                name: 'get_mouse_position',
                description: 'Get current mouse cursor position.',
                inputSchema: toJsonSchema(GetMousePositionSchema),
            },
            {
                name: 'batch_keyboard_actions',
                description: 'Execute sequence of keyboard actions (type, press, shortcut, wait).',
                inputSchema: toJsonSchema(BatchKeyboardActionsSchema),
            },
            {
                name: 'batch_mouse_actions',
                description: 'Execute sequence of mouse actions (move, click, drag, scroll, wait).',
                inputSchema: toJsonSchema(BatchMouseActionsSchema),
            },

            // ==========================================
            // === Window Management ===
            // ==========================================
            {
                name: 'list_windows',
                description: 'List all open windows with titles and process info.',
                inputSchema: toJsonSchema(ListWindowsSchema),
            },
            {
                name: 'get_active_window',
                description: 'Get information about the currently focused window.',
                inputSchema: toJsonSchema(GetActiveWindowSchema),
            },
            {
                name: 'focus_window',
                description: 'Bring a window to the foreground by title or PID.',
                inputSchema: toJsonSchema(FocusWindowSchema),
            },
            {
                name: 'minimize_window',
                description: 'Minimize a window or all windows.',
                inputSchema: toJsonSchema(MinimizeWindowSchema),
            },
            {
                name: 'maximize_window',
                description: 'Maximize the active or specified window.',
                inputSchema: toJsonSchema(MaximizeWindowSchema),
            },
            {
                name: 'restore_window',
                description: 'Restore a minimized/maximized window.',
                inputSchema: toJsonSchema(RestoreWindowSchema),
            },
            {
                name: 'close_window',
                description: 'Close a window. Use force to kill the process.',
                inputSchema: toJsonSchema(CloseWindowSchema),
            },
            {
                name: 'resize_window',
                description: 'Resize the active or specified window.',
                inputSchema: toJsonSchema(ResizeWindowSchema, ['width', 'height']),
            },
            {
                name: 'move_window',
                description: 'Move the active or specified window.',
                inputSchema: toJsonSchema(MoveWindowSchema, ['x', 'y']),
            },
            {
                name: 'launch_application',
                description: 'Launch an application by path or name.',
                inputSchema: toJsonSchema(LaunchApplicationSchema, ['path']),
            },
            {
                name: 'wait_for_window',
                description: 'Wait for a window to appear. Matches process name or window title.',
                inputSchema: toJsonSchema(WaitForWindowSchema, ['title']),
            },


            // ==========================================
            // === Clipboard ===
            // ==========================================
            {
                name: 'clipboard_read',
                description: 'Read clipboard contents (text, HTML, or image as base64).',
                inputSchema: toJsonSchema(ClipboardReadSchema),
            },
            {
                name: 'clipboard_write',
                description: 'Write text or HTML to clipboard.',
                inputSchema: toJsonSchema(ClipboardWriteSchema, ['content']),
            },
            {
                name: 'clipboard_clear',
                description: 'Clear the clipboard.',
                inputSchema: toJsonSchema(ClipboardClearSchema),
            },
            {
                name: 'clipboard_has_format',
                description: 'Check if clipboard contains a specific format.',
                inputSchema: toJsonSchema(ClipboardHasFormatSchema, ['format']),
            },

            // ==========================================
            // === System Operations ===
            // ==========================================
            {
                name: 'get_system_info',
                description: 'Get system information (OS, CPU, memory, uptime).',
                inputSchema: toJsonSchema(GetSystemInfoSchema),
            },
            {
                name: 'list_processes',
                description: 'List running processes with CPU/memory usage.',
                inputSchema: toJsonSchema(ListProcessesSchema),
            },
            {
                name: 'kill_process',
                description: 'Kill a process by PID or name.',
                inputSchema: toJsonSchema(KillProcessSchema),
            },
            {
                name: 'get_environment',
                description: 'Get environment variable(s).',
                inputSchema: toJsonSchema(GetEnvironmentSchema),
            },
            {
                name: 'set_environment',
                description: 'Set an environment variable.',
                inputSchema: toJsonSchema(SetEnvironmentSchema, ['variable', 'value']),
            },
            {
                name: 'get_network_info',
                description: 'Get network interface information.',
                inputSchema: toJsonSchema(GetNetworkInfoSchema),
            },
            {
                name: 'wait',
                description: 'Wait/sleep for specified milliseconds. Use in action sequences.',
                inputSchema: toJsonSchema(WaitSchema, ['ms']),
            },
            {
                name: 'notify',
                description: 'Show a system notification.',
                inputSchema: toJsonSchema(NotifySchema, ['title', 'message']),
            },

            // ==========================================
            // === Configuration Management ===
            // ==========================================
            {
                name: 'get_config',
                description: 'Get current MCP server configuration. Optionally specify a section (storage, cliPolicy, crud).',
                inputSchema: toJsonSchema(GetConfigSchema),
            },
            {
                name: 'set_config_value',
                description: 'Set a configuration value using dot notation (e.g., "cliPolicy.timeoutMs", "crud.defaultLimit"). Changes persist to disk.',
                inputSchema: toJsonSchema(SetConfigValueSchema, ['key', 'value']),
            },
            {
                name: 'reset_config',
                description: 'Reset configuration to defaults. Optionally specify a section to reset only that section.',
                inputSchema: toJsonSchema(ResetConfigSchema),
            },

            // ==========================================
            // === Analytics & Usage Stats ===
            // ==========================================
            {
                name: 'get_usage_stats',
                description: 'Get tool usage statistics including call counts, error rates, and hourly distribution.',
                inputSchema: toJsonSchema(GetUsageStatsSchema),
            },
            {
                name: 'get_recent_tool_calls',
                description: 'Get recent tool call history from the audit log. Useful for debugging.',
                inputSchema: toJsonSchema(GetRecentToolCallsSchema),
            },
            {
                name: 'get_audit_log_stats',
                description: 'Get audit log statistics including total entries and database size.',
                inputSchema: toJsonSchema(GetAuditLogStatsSchema),
            },
            {
                name: 'clear_old_logs',
                description: 'Delete audit log entries older than specified days. Use dryRun=true to preview.',
                inputSchema: toJsonSchema(ClearOldLogsSchema, ['olderThanDays']),
            },

            // ==========================================
            // === Paginated Search ===
            // ==========================================
            {
                name: 'start_search',
                description: 'Start a paginated file search. Returns searchId for retrieving results. Use for large directories.',
                inputSchema: toJsonSchema(StartSearchSchema, ['directory', 'pattern']),
            },
            {
                name: 'get_search_results',
                description: 'Get paginated results from a search session. Automatically advances cursor for next call.',
                inputSchema: toJsonSchema(GetSearchResultsSchema, ['searchId']),
            },
            {
                name: 'list_active_searches',
                description: 'List all active search sessions with their status.',
                inputSchema: toJsonSchema(ListSearchesSchema),
            },
            {
                name: 'stop_search',
                description: 'Stop a search session and cleanup resources.',
                inputSchema: toJsonSchema(StopSearchSchema, ['searchId']),
            },

            // ==========================================
            // === Browser Automation ===
            // ==========================================
            {
                name: 'launch_browser',
                description: 'Launch a browser instance (Puppeteer or Playwright). Toggles headless mode.',
                inputSchema: toJsonSchema(LaunchBrowserSchema),
            },
            {
                name: 'close_browser',
                description: 'Close the browser instance and cleanup.',
                inputSchema: toJsonSchema(CloseBrowserSchema),
            },
            {
                name: 'navigate_page',
                description: 'Navigate to a URL and wait for load.',
                inputSchema: toJsonSchema(NavigatePageSchema, ['url']),
            },
            {
                name: 'get_page_content',
                description: 'Get page content in HTML, text, or markdown format.',
                inputSchema: toJsonSchema(GetPageContentSchema),
            },
            {
                name: 'click_element',
                description: 'Click an element identified by CSS/XPath selector.',
                inputSchema: toJsonSchema(ClickElementSchema, ['selector']),
            },
            {
                name: 'type_text',
                description: 'Type text into an input field.',
                inputSchema: toJsonSchema(TypeTextSchema, ['selector', 'text']),
            },
            {
                name: 'evaluate_js',
                description: 'Execute JavaScript code in the page context.',
                inputSchema: toJsonSchema(EvalJsSchema, ['script']),
            },
            {
                name: 'screenshot_page',
                description: 'Capture a full-page screenshot (returns base64).',
                inputSchema: toJsonSchema(ScreenshotPageSchema),
            },
            {
                name: 'get_console_logs',
                description: 'Retrieve captured console logs from the browser.',
                inputSchema: toJsonSchema(GetConsoleLogsSchema),
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
        throw new Error('No arguments provided');
    }

    switch (name) {
        // CLI & File operations
        case 'exec_cli': return handleExecCli(args as any) as any;
        case 'execute_code': return handleExecuteCode(args as any) as any;
        case 'read_file': return handleReadFile(args as any) as any;
        case 'write_file': return handleWriteFile(args as any) as any;
        case 'list_directory': return handleListDirectory(args as any) as any;
        case 'str_replace': return handleStrReplace(args as any) as any;
        case 'copy_file': return handleCopyFile(args as any) as any;
        case 'move_file': return handleMoveFile(args as any) as any;
        case 'delete_file': return handleDeleteFile(args as any) as any;
        case 'file_info': return handleFileInfo(args as any) as any;
        case 'search_files': return handleSearchFiles(args as any) as any;
        case 'read_file_lines': return handleReadFileLines(args as any) as any;
        case 'search_in_file': return handleSearchInFile(args as any) as any;
        case 'batch_exec_cli': return handleBatchExecCli(args as any) as any;
        case 'batch_read_files': return handleBatchReadFiles(args as any) as any;
        case 'batch_write_files': return handleBatchWriteFiles(args as any) as any;
        case 'batch_list_directories': return handleBatchListDirectories(args as any) as any;
        case 'batch_copy_files': return handleBatchCopyFiles(args as any) as any;
        case 'batch_move_files': return handleBatchMoveFiles(args as any) as any;
        case 'batch_delete_files': return handleBatchDeleteFiles(args as any) as any;
        case 'batch_file_info': return handleBatchFileInfo(args as any) as any;
        case 'batch_str_replace': return handleBatchStrReplace(args as any) as any;
        case 'batch_search_in_files': return handleBatchSearchInFiles(args as any) as any;

        // Diff-based editing
        case 'edit_block': return handleEditBlock(args as any) as any;
        case 'apply_diff': return handleApplyDiff(args as any) as any;
        case 'get_diff_preview': return handleGetDiffPreview(args as any) as any;
        case 'batch_edit_blocks': return handleBatchEditBlocks(args as any) as any;
        case 'write_from_line': return handleWriteFromLine(args as any) as any;

        // Generic batch tools
        case 'batch_tools': return handleBatchTools(args as any) as any;

        // Interactive process sessions
        case 'start_process': return handleStartProcess(args as any) as any;
        case 'interact_with_process': return handleInteractWithProcess(args as any) as any;
        case 'read_process_output': return handleReadProcessOutput(args as any) as any;
        case 'list_sessions': return handleListSessions() as any;
        case 'terminate_process': return handleTerminateProcess(args as any) as any;

        // CRUD operations
        case 'crud_create': return handleCrudCreate(args as any) as any;
        case 'crud_read': return handleCrudRead(args as any) as any;
        case 'crud_update': return handleCrudUpdate(args as any) as any;
        case 'crud_delete': return handleCrudDelete(args as any) as any;
        case 'crud_query': return handleCrudQuery(args as any) as any;
        case 'crud_batch_create': return handleCrudBatchCreate(args as any) as any;
        case 'crud_batch_read': return handleCrudBatchRead(args as any) as any;
        case 'crud_batch_update': return handleCrudBatchUpdate(args as any) as any;
        case 'crud_batch_delete': return handleCrudBatchDelete(args as any) as any;

        // Screen perception
        case 'screenshot': return handleScreenshot(args as any) as any;
        case 'get_screen_info': return handleGetScreenInfo() as any;
        case 'wait_for_screen_change': return handleWaitForScreenChange(args as any) as any;
        case 'find_on_screen': return handleFindOnScreen(args as any) as any;

        // Input simulation
        case 'keyboard_type': return handleKeyboardType(args as any) as any;
        case 'keyboard_press': return handleKeyboardPress(args as any) as any;
        case 'keyboard_shortcut': return handleKeyboardShortcut(args as any) as any;
        case 'mouse_move': return handleMouseMove(args as any) as any;
        case 'mouse_click': return handleMouseClick(args as any) as any;
        case 'mouse_drag': return handleMouseDrag(args as any) as any;
        case 'mouse_scroll': return handleMouseScroll(args as any) as any;
        case 'get_mouse_position': return handleGetMousePosition() as any;
        case 'batch_keyboard_actions': return handleBatchKeyboardActions(args as any) as any;
        case 'batch_mouse_actions': return handleBatchMouseActions(args as any) as any;

        // Window management
        case 'list_windows': return handleListWindows() as any;
        case 'get_active_window': return handleGetActiveWindow() as any;
        case 'focus_window': return handleFocusWindow(args as any) as any;
        case 'minimize_window': return handleMinimizeWindow(args as any) as any;
        case 'maximize_window': return handleMaximizeWindow(args as any) as any;
        case 'restore_window': return handleRestoreWindow(args as any) as any;
        case 'close_window': return handleCloseWindow(args as any) as any;
        case 'resize_window': return handleResizeWindow(args as any) as any;
        case 'move_window': return handleMoveWindow(args as any) as any;
        case 'launch_application': return handleLaunchApplication(args as any) as any;
        case 'wait_for_window': return handleWaitForWindow(args as any) as any;

        // Clipboard
        case 'clipboard_read': return handleClipboardRead(args as any) as any;
        case 'clipboard_write': return handleClipboardWrite(args as any) as any;
        case 'clipboard_clear': return handleClipboardClear() as any;
        case 'clipboard_has_format': return handleClipboardHasFormat(args as any) as any;

        // System
        case 'get_system_info': return handleGetSystemInfo() as any;
        case 'list_processes': return handleListProcesses(args as any) as any;
        case 'kill_process': return handleKillProcess(args as any) as any;
        case 'get_environment': return handleGetEnvironment(args as any) as any;
        case 'set_environment': return handleSetEnvironment(args as any) as any;
        case 'get_network_info': return handleGetNetworkInfo() as any;
        case 'wait': return handleWait(args as any) as any;
        case 'notify': return handleNotify(args as any) as any;

        // Configuration Management
        case 'get_config': return handleGetConfig(args as any) as any;
        case 'set_config_value': return handleSetConfigValue(args as any) as any;
        case 'reset_config': return handleResetConfig(args as any) as any;

        // Analytics & Usage Stats
        case 'get_usage_stats': return handleGetUsageStats(args as any) as any;
        case 'get_recent_tool_calls': return handleGetRecentToolCalls(args as any) as any;
        case 'get_audit_log_stats': return handleGetAuditLogStats() as any;
        case 'clear_old_logs': return handleClearOldLogs(args as any) as any;

        // Paginated Search
        case 'start_search': return handleStartSearch(args as any) as any;
        case 'get_search_results': return handleGetSearchResults(args as any) as any;
        case 'list_active_searches': return handleListSearches() as any;
        case 'stop_search': return handleStopSearch(args as any) as any;

        // Browser Automation
        case 'launch_browser': return handleLaunchBrowser(args as any) as any;
        case 'close_browser': return handleCloseBrowser() as any;
        case 'navigate_page': return handleNavigatePage(args as any) as any;
        case 'get_page_content': return handleGetPageContent(args as any) as any;
        case 'click_element': return handleClickElement(args as any) as any;
        case 'type_text': return handleTypeText(args as any) as any;
        case 'evaluate_js': return handleEvalJs(args as any) as any;
        case 'screenshot_page': return handleScreenshotPage() as any;
        case 'get_console_logs': return handleGetConsoleLogs() as any;

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
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
