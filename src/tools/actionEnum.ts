/**
 * Action Enum - Centralized tool registry for OODA MCP server
 * 
 * This enum consolidates all tool definitions into a single source of truth
 * for consistency and maintainability. Each tool is defined with:
 * - Name (slug format for MCP)
 * - Description (user-friendly explanation)
 * - Category (for organization)
 * - Handler reference (function to execute)
 * - Input schema (Zod validation)
 * 
 * This replaces the scattered tool definitions across multiple files and
 * provides a clear audit trail for tool changes.
 */

import { z } from 'zod';
import * as cliTools from './cli.js';
import * as crudTools from './crud.js';
import * as filesystemTools from './filesystem.js';
import * as screenTools from './screen.js';
import * as inputTools from './input.js';
import * as windowTools from './window.js';
import * as clipboardTools from './clipboard.js';
import * as systemTools from './system.js';
import * as diffTools from './diff/index.js';
import * as tailFileTools from './tailFile.js';
import * as sessionTools from './sessions.js';
import * as configTools from './configTools.js';
import * as analyticsTools from './analytics.js';
import * as executeCodeTools from './executeCode.js';
import * as paginatedSearchTools from './paginatedSearch.js';
import * as browserTools from './browser/tools.js';
import { BatchToolsSchema } from './batchTools.js';

// Tool categories for organization
export enum ToolCategory {
  CLI = 'CLI & File Operations',
  DIFF = 'Diff-Based Editing',
  SESSIONS = 'Interactive Process Sessions',
  CRUD = 'CRUD Database Operations',
  SCREEN = 'Screen Perception (OBSERVE)',
  INPUT = 'Input Simulation (ACT)',
  WINDOW = 'Window Management',
  CLIPBOARD = 'Clipboard',
  SYSTEM = 'System Operations',
  CONFIG = 'Configuration Management',
  ANALYTICS = 'Analytics & Usage Stats',
  EXECUTE_CODE = 'Code Execution',
  PAGINATED_SEARCH = 'Paginated Search',
  BROWSER = 'Browser Automation',
  BATCH = 'Batch Operations'
}

// Interface for tool definitions
export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  handler: (args: any) => Promise<any>;
  inputSchema: Record<string, any>;
  requiredFields?: string[];
}

// Main Action Enum - all tools defined here
export const ActionEnum: Record<string, ToolDefinition> = {
  // ==========================================
  // === CLI & File Operations ===
  // ==========================================
  exec_cli: {
    name: 'exec_cli',
    description: 'Execute shell commands on the host system (YOLO mode)',
    category: ToolCategory.CLI,
    handler: cliTools.handleExecCli,
    inputSchema: cliTools.ExecCliSchema,
    requiredFields: ['command']
  },
  execute_code: {
    name: 'execute_code',
    description: 'Execute code in memory without saving to file. Supports python, node, r, powershell, bash.',
    category: ToolCategory.EXECUTE_CODE,
    handler: executeCodeTools.handleExecuteCode,
    inputSchema: executeCodeTools.ExecuteCodeSchema,
    requiredFields: ['language', 'code']
  },
  read_file: {
    name: 'read_file',
    description: 'Read file contents. ⚠️ CONTEXT WARNING: Truncates at 500 lines. For large files or targeted access, PREFER these surgical alternatives:\n• read_file_lines - Read specific line ranges (use offset: -50 for last 50 lines)\n• search_in_file - Find patterns with context lines\n• edit_block - Search/replace without full read\nFull file reads consume context rapidly. Be surgical.',
    category: ToolCategory.CLI,
    handler: cliTools.handleReadFile,
    inputSchema: cliTools.ReadFileSchema,
    requiredFields: ['path']
  },
  write_file: {
    name: 'write_file',
    description: 'Write content to a file',
    category: ToolCategory.CLI,
    handler: cliTools.handleWriteFile,
    inputSchema: cliTools.WriteFileSchema,
    requiredFields: ['path', 'content']
  },
  list_directory: {
    name: 'list_directory',
    description: 'List contents of a directory',
    category: ToolCategory.CLI,
    handler: cliTools.handleListDirectory,
    inputSchema: cliTools.ListDirectorySchema,
    requiredFields: ['path']
  },
  str_replace: {
    name: 'str_replace',
    description: 'Replace a unique string in a file with another string. Handles CRLF/LF line-ending mismatches automatically (search text uses file\'s convention). The string to replace must appear exactly once. For fuzzy matching or partial matches, use edit_block instead; for multi-block edits on one file, use apply_diff.',
    category: ToolCategory.CLI,
    handler: cliTools.handleStrReplace,
    inputSchema: cliTools.StrReplaceSchema,
    requiredFields: ['path', 'oldText']
  },
  copy_file: {
    name: 'copy_file',
    description: 'Copy a file or directory. For multiple operations, use batch_tools with copy_file operations.',
    category: ToolCategory.CLI,
    handler: filesystemTools.handleCopyFile,
    inputSchema: filesystemTools.CopyFileSchema,
    requiredFields: ['source', 'destination']
  },
  move_file: {
    name: 'move_file',
    description: 'Move/rename a file or directory. For multiple operations, use batch_tools with move_file operations.',
    category: ToolCategory.CLI,
    handler: filesystemTools.handleMoveFile,
    inputSchema: filesystemTools.MoveFileSchema,
    requiredFields: ['source', 'destination']
  },
  delete_file: {
    name: 'delete_file',
    description: 'Delete a file or directory. For multiple deletions, use batch_tools with delete_file operations.',
    category: ToolCategory.CLI,
    handler: filesystemTools.handleDeleteFile,
    inputSchema: filesystemTools.DeleteFileSchema,
    requiredFields: ['path']
  },
  file_info: {
    name: 'file_info',
    description: 'Get file/directory metadata (size, dates, type). For multiple paths, use batch_tools with file_info operations.',
    category: ToolCategory.CLI,
    handler: filesystemTools.handleFileInfo,
    inputSchema: filesystemTools.FileInfoSchema,
    requiredFields: ['path']
  },
  search_files: {
    name: 'search_files',
    description: 'Search for files by pattern in a directory tree.',
    category: ToolCategory.CLI,
    handler: filesystemTools.handleSearchFiles,
    inputSchema: filesystemTools.SearchFilesSchema,
    requiredFields: ['directory', 'pattern']
  },
  read_file_lines: {
    name: 'read_file_lines',
    description: 'Read specific lines from a file (token-efficient). Returns line range with optional line numbers. Use this instead of read_file when you only need a portion of a large file.',
    category: ToolCategory.CLI,
    handler: cliTools.handleReadFileLines,
    inputSchema: cliTools.ReadFileLinesSchema,
    requiredFields: ['path']
  },
  search_in_file: {
    name: 'search_in_file',
    description: 'Search for text or regex patterns within a file. Returns matching lines with optional context. More efficient than reading entire file when looking for specific content.',
    category: ToolCategory.CLI,
    handler: cliTools.handleSearchInFile,
    inputSchema: cliTools.SearchInFileSchema,
    requiredFields: ['path', 'pattern']
  },
  tail_file: {
    name: 'tail_file',
    description: 'Poll a growing file for new content, OR block waiting for new content up to a timeout. Byte-offset cursor lets you resume cleanly across multiple calls. Use fromByte=<previous endByte> to resume streaming. Use timeoutSeconds>0 to block until new content appears (good for watching logs while telling the user to interact with an app). Detects file rotation via size shrink. Prefer this over exec_cli with Get-Content -Wait.',
    category: ToolCategory.CLI,
    handler: tailFileTools.handleTailFile,
    inputSchema: tailFileTools.TailFileSchema,
    requiredFields: ['path']
  },

  // ==========================================
  // === Diff-Based Editing ===
  // ==========================================
  edit_block: {
    name: 'edit_block',
    description: 'Search and replace text in a file with fuzzy matching fallback. Shows diff preview when exact match fails. Use expectedReplacements to control how many occurrences to replace. Use dryRun=true for preview only.',
    category: ToolCategory.DIFF,
    handler: diffTools.handleEditBlock,
    inputSchema: diffTools.EditBlockSchema,
    requiredFields: ['path', 'search', 'replace']
  },
  apply_diff: {
    name: 'apply_diff',
    description: 'Apply multiple search/replace operations to a file in a single atomic operation. Validates all blocks before applying any changes. Use dryRun=true for preview. Use startLine hints for faster matching in large files.',
    category: ToolCategory.DIFF,
    handler: diffTools.handleApplyDiff,
    inputSchema: diffTools.ApplyDiffSchema,
    requiredFields: ['path', 'diffs']
  },
  get_diff_preview: {
    name: 'get_diff_preview',
    description: 'Generate a diff preview showing what changes would be made without applying them. Supports unified, inline (character-level), and side-by-side formats.',
    category: ToolCategory.DIFF,
    handler: diffTools.handleGetDiffPreview,
    inputSchema: diffTools.GetDiffPreviewSchema,
    requiredFields: ['path', 'search', 'replace']
  },
  batch_edit_blocks: {
    name: 'batch_edit_blocks',
    description: 'Apply multiple search/replace operations to a single file sequentially. Each edit operates on the result of the previous edit. Supports partial success - completed edits are saved even if later edits fail. Use stopOnError to halt on first failure. Use dryRun for preview.',
    category: ToolCategory.DIFF,
    handler: diffTools.handleBatchEditBlocksMcp,
    inputSchema: diffTools.BatchEditBlocksSchema,
    requiredFields: ['path', 'edits']
  },
  write_from_line: {
    name: 'write_from_line',
    description: 'Replace content starting from a specific line number. Use startLine to keep lines 1-(startLine-1) and replace from startLine to EOF (or to endLine if specified). Ideal for bulk section replacement in large files without sending entire file content.',
    category: ToolCategory.DIFF,
    handler: diffTools.handleWriteFromLineMcp,
    inputSchema: diffTools.WriteFromLineSchema,
    requiredFields: ['path', 'startLine', 'content']
  },

  // ==========================================
  // === Generic Batch Tools ===
  // ==========================================
  batch_tools: {
    name: 'batch_tools',
    description: 'Execute multiple tool operations in parallel or sequential mode. Can batch ANY tool type (read_file, exec_cli, list_directory, etc.) with unified safety limits. Each operation: {tool: "tool_name", args: {...}, label?: "string"}. Enforces: 50 ops max per batch, 200KB aggregate output (configurable via ~/.mcp/config.json). Use executionMode="parallel" (default) for independent ops like reading multiple files; use "sequential" for ordered ops where later ones depend on earlier ones, with optional stopOnError. For multi-edit on a single file, prefer batch_edit_blocks instead.',
    category: ToolCategory.BATCH,
    handler: async (args: any) => {
      const { handleBatchTools } = await import('./batchDispatcher.js');
      return handleBatchTools(args);
    },
    inputSchema: BatchToolsSchema,
    requiredFields: ['operations']
  },

  // ==========================================
  // === Interactive Process Sessions ===
  // ==========================================
  start_process: {
    name: 'start_process',
    description: 'Start a new interactive process session. Returns a sessionId for subsequent interactions. Use for long-running processes, REPLs, SSH, or any process requiring stdin/stdout interaction.',
    category: ToolCategory.SESSIONS,
    handler: sessionTools.handleStartProcess,
    inputSchema: sessionTools.StartProcessSchema,
    requiredFields: ['command']
  },
  interact_with_process: {
    name: 'interact_with_process',
    description: 'Send input to a running process session. Input is written to the process stdin.',
    category: ToolCategory.SESSIONS,
    handler: sessionTools.handleInteractWithProcess,
    inputSchema: sessionTools.InteractWithProcessSchema,
    requiredFields: ['sessionId', 'input']
  },
  read_process_output: {
    name: 'read_process_output',
    description: 'Read output from a process session. Use negative lines value to read last N lines. Use clear=true to clear the buffer after reading.',
    category: ToolCategory.SESSIONS,
    handler: sessionTools.handleReadProcessOutput,
    inputSchema: sessionTools.ReadProcessOutputSchema,
    requiredFields: ['sessionId']
  },
  list_sessions: {
    name: 'list_sessions',
    description: 'List all active process sessions with their status and basic info.',
    category: ToolCategory.SESSIONS,
    handler: sessionTools.handleListSessions,
    inputSchema: sessionTools.ListSessionsSchema
  },
  terminate_process: {
    name: 'terminate_process',
    description: 'Terminate a process session. Use force=true for SIGKILL instead of graceful SIGTERM.',
    category: ToolCategory.SESSIONS,
    handler: sessionTools.handleTerminateProcess,
    inputSchema: sessionTools.TerminateProcessSchema,
    requiredFields: ['sessionId']
  },

  // ==========================================
  // === CRUD Database Operations ===
  // ==========================================
  crud_create: {
    name: 'crud_create',
    description: 'Create a new record in a collection',
    category: ToolCategory.CRUD,
    handler: crudTools.handleCrudCreate,
    inputSchema: crudTools.CrudCreateSchema,
    requiredFields: ['collection', 'data']
  },
  crud_read: {
    name: 'crud_read',
    description: 'Read a record by ID',
    category: ToolCategory.CRUD,
    handler: crudTools.handleCrudRead,
    inputSchema: crudTools.CrudReadSchema,
    requiredFields: ['collection', 'id']
  },
  crud_update: {
    name: 'crud_update',
    description: 'Update an existing record',
    category: ToolCategory.CRUD,
    handler: crudTools.handleCrudUpdate,
    inputSchema: crudTools.CrudUpdateSchema,
    requiredFields: ['collection', 'id', 'data']
  },
  crud_delete: {
    name: 'crud_delete',
    description: 'Delete a record',
    category: ToolCategory.CRUD,
    handler: crudTools.handleCrudDelete,
    inputSchema: crudTools.CrudDeleteSchema,
    requiredFields: ['collection', 'id']
  },
  crud_query: {
    name: 'crud_query',
    description: 'Query records in a collection',
    category: ToolCategory.CRUD,
    handler: crudTools.handleCrudQuery,
    inputSchema: crudTools.CrudQuerySchema,
    requiredFields: ['collection']
  },

  // ==========================================
  // === Screen Perception (OBSERVE) ===
  // ==========================================
  screenshot: {
    name: 'screenshot',
    description: 'Capture screenshot of screen or region. Returns base64 image or saves to file.',
    category: ToolCategory.SCREEN,
    handler: screenTools.handleScreenshot,
    inputSchema: screenTools.ScreenshotSchema
  },
  get_screen_info: {
    name: 'get_screen_info',
    description: 'Get display/monitor information (resolution, count, positions).',
    category: ToolCategory.SCREEN,
    handler: screenTools.handleGetScreenInfo,
    inputSchema: screenTools.GetScreenInfoSchema
  },
  wait_for_screen_change: {
    name: 'wait_for_screen_change',
    description: 'Wait until screen content changes in a region. Useful for detecting UI updates.',
    category: ToolCategory.SCREEN,
    handler: screenTools.handleWaitForScreenChange,
    inputSchema: screenTools.WaitForScreenChangeSchema
  },
  find_on_screen: {
    name: 'find_on_screen',
    description: 'Find text or image on screen (requires OCR/template matching dependencies).',
    category: ToolCategory.SCREEN,
    handler: screenTools.handleFindOnScreen,
    inputSchema: screenTools.FindOnScreenSchema
  },

  // ==========================================
  // === Input Simulation (ACT) ===
  // ==========================================
  keyboard_type: {
    name: 'keyboard_type',
    description: 'Type text as keyboard input.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleKeyboardType,
    inputSchema: inputTools.KeyboardTypeSchema,
    requiredFields: ['text']
  },
  keyboard_press: {
    name: 'keyboard_press',
    description: 'Press a key with optional modifiers (ctrl, alt, shift).',
    category: ToolCategory.INPUT,
    handler: inputTools.handleKeyboardPress,
    inputSchema: inputTools.KeyboardPressSchema,
    requiredFields: ['key']
  },
  keyboard_shortcut: {
    name: 'keyboard_shortcut',
    description: 'Execute keyboard shortcut (e.g., "ctrl+c", "alt+tab").',
    category: ToolCategory.INPUT,
    handler: inputTools.handleKeyboardShortcut,
    inputSchema: inputTools.KeyboardShortcutSchema,
    requiredFields: ['shortcut']
  },
  mouse_move: {
    name: 'mouse_move',
    description: 'Move mouse cursor to coordinates.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleMouseMove,
    inputSchema: inputTools.MouseMoveSchema,
    requiredFields: ['x', 'y']
  },
  mouse_click: {
    name: 'mouse_click',
    description: 'Click mouse button at position. Supports double-click.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleMouseClick,
    inputSchema: inputTools.MouseClickSchema
  },
  mouse_drag: {
    name: 'mouse_drag',
    description: 'Drag from one position to another.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleMouseDrag,
    inputSchema: inputTools.MouseDragSchema,
    requiredFields: ['startX', 'startY', 'endX', 'endY']
  },
  mouse_scroll: {
    name: 'mouse_scroll',
    description: 'Scroll mouse wheel.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleMouseScroll,
    inputSchema: inputTools.MouseScrollSchema,
    requiredFields: ['deltaY']
  },
  get_mouse_position: {
    name: 'get_mouse_position',
    description: 'Get current mouse cursor position.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleGetMousePosition,
    inputSchema: inputTools.GetMousePositionSchema
  },
  verify_mouse_target: {
    name: 'verify_mouse_target',
    description: 'Diagnostic: move the cursor to (x, y), read back the actual position, report the offset. Validates multi-monitor / DPI correctness without trial-and-error clicking. A correctly-functioning setup produces offset=(0,0) or ±1 pixel. Large offsets indicate DPI scaling is still being applied (PER_MONITOR_AWARE_V2 not active). Call this before debugging "my click landed off-target" issues. Cursor is restored to starting position after the test.',
    category: ToolCategory.INPUT,
    handler: inputTools.handleVerifyMouseTarget,
    inputSchema: inputTools.VerifyMouseTargetSchema,
    requiredFields: ['x', 'y']
  },

  // ==========================================
  // === Window Management ===
  // ==========================================
  list_windows: {
    name: 'list_windows',
    description: 'List all open windows with titles and process info.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleListWindows,
    inputSchema: windowTools.ListWindowsSchema
  },
  get_active_window: {
    name: 'get_active_window',
    description: 'Get information about the currently focused window.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleGetActiveWindow,
    inputSchema: windowTools.GetActiveWindowSchema
  },
  focus_window: {
    name: 'focus_window',
    description: 'Bring a window to the foreground by title or PID.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleFocusWindow,
    inputSchema: windowTools.FocusWindowSchema
  },
  minimize_window: {
    name: 'minimize_window',
    description: 'Minimize a window or all windows.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleMinimizeWindow,
    inputSchema: windowTools.MinimizeWindowSchema
  },
  maximize_window: {
    name: 'maximize_window',
    description: 'Maximize the active or specified window.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleMaximizeWindow,
    inputSchema: windowTools.MaximizeWindowSchema
  },
  restore_window: {
    name: 'restore_window',
    description: 'Restore a minimized/maximized window.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleRestoreWindow,
    inputSchema: windowTools.RestoreWindowSchema
  },
  close_window: {
    name: 'close_window',
    description: 'Close a window. Use force to kill the process.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleCloseWindow,
    inputSchema: windowTools.CloseWindowSchema
  },
  resize_window: {
    name: 'resize_window',
    description: 'Resize the active or specified window.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleResizeWindow,
    inputSchema: windowTools.ResizeWindowSchema,
    requiredFields: ['width', 'height']
  },
  move_window: {
    name: 'move_window',
    description: 'Move the active or specified window.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleMoveWindow,
    inputSchema: windowTools.MoveWindowSchema,
    requiredFields: ['x', 'y']
  },
  launch_application: {
    name: 'launch_application',
    description: 'Launch an application by path or name.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleLaunchApplication,
    inputSchema: windowTools.LaunchApplicationSchema,
    requiredFields: ['path']
  },
  wait_for_window: {
    name: 'wait_for_window',
    description: 'Wait for a window to appear. Matches process name or window title.',
    category: ToolCategory.WINDOW,
    handler: windowTools.handleWaitForWindow,
    inputSchema: windowTools.WaitForWindowSchema,
    requiredFields: ['title']
  },

  // ==========================================
  // === Clipboard ===
  // ==========================================
  clipboard_read: {
    name: 'clipboard_read',
    description: 'Read clipboard contents (text, HTML, or image as base64).',
    category: ToolCategory.CLIPBOARD,
    handler: clipboardTools.handleClipboardRead,
    inputSchema: clipboardTools.ClipboardReadSchema
  },
  clipboard_write: {
    name: 'clipboard_write',
    description: 'Write text or HTML to clipboard.',
    category: ToolCategory.CLIPBOARD,
    handler: clipboardTools.handleClipboardWrite,
    inputSchema: clipboardTools.ClipboardWriteSchema,
    requiredFields: ['content']
  },
  clipboard_clear: {
    name: 'clipboard_clear',
    description: 'Clear the clipboard.',
    category: ToolCategory.CLIPBOARD,
    handler: clipboardTools.handleClipboardClear,
    inputSchema: clipboardTools.ClipboardClearSchema
  },
  clipboard_has_format: {
    name: 'clipboard_has_format',
    description: 'Check if clipboard contains a specific format.',
    category: ToolCategory.CLIPBOARD,
    handler: clipboardTools.handleClipboardHasFormat,
    inputSchema: clipboardTools.ClipboardHasFormatSchema,
    requiredFields: ['format']
  },

  // ==========================================
  // === System Operations ===
  // ==========================================
  get_system_info: {
    name: 'get_system_info',
    description: 'Get system information (OS, CPU, memory, uptime).',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleGetSystemInfo,
    inputSchema: systemTools.GetSystemInfoSchema
  },
  list_processes: {
    name: 'list_processes',
    description: 'List running processes with CPU/memory usage.',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleListProcesses,
    inputSchema: systemTools.ListProcessesSchema
  },
  kill_process: {
    name: 'kill_process',
    description: 'Kill a process by PID or name.',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleKillProcess,
    inputSchema: systemTools.KillProcessSchema
  },
  get_environment: {
    name: 'get_environment',
    description: 'Get environment variable(s).',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleGetEnvironment,
    inputSchema: systemTools.GetEnvironmentSchema
  },
  set_environment: {
    name: 'set_environment',
    description: 'Set an environment variable.',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleSetEnvironment,
    inputSchema: systemTools.SetEnvironmentSchema,
    requiredFields: ['variable', 'value']
  },
  get_network_info: {
    name: 'get_network_info',
    description: 'Get network interface information.',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleGetNetworkInfo,
    inputSchema: systemTools.GetNetworkInfoSchema
  },
  wait: {
    name: 'wait',
    description: 'Wait/sleep for specified milliseconds. Use in action sequences.',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleWait,
    inputSchema: systemTools.WaitSchema,
    requiredFields: ['ms']
  },
  notify: {
    name: 'notify',
    description: 'Show a system notification.',
    category: ToolCategory.SYSTEM,
    handler: systemTools.handleNotify,
    inputSchema: systemTools.NotifySchema,
    requiredFields: ['title', 'message']
  },

  // ==========================================
  // === Configuration Management ===
  // ==========================================
  get_config: {
    name: 'get_config',
    description: 'Get current MCP server configuration. Optionally specify a section (storage, cliPolicy, crud).',
    category: ToolCategory.CONFIG,
    handler: configTools.handleGetConfig,
    inputSchema: configTools.GetConfigSchema
  },
  set_config_value: {
    name: 'set_config_value',
    description: 'Set a configuration value using dot notation (e.g., "cliPolicy.timeoutMs", "crud.defaultLimit"). Changes persist to disk.',
    category: ToolCategory.CONFIG,
    handler: configTools.handleSetConfigValue,
    inputSchema: configTools.SetConfigValueSchema,
    requiredFields: ['key', 'value']
  },
  reset_config: {
    name: 'reset_config',
    description: 'Reset configuration to defaults. Optionally specify a section to reset only that section.',
    category: ToolCategory.CONFIG,
    handler: configTools.handleResetConfig,
    inputSchema: configTools.ResetConfigSchema
  },

  // ==========================================
  // === Analytics & Usage Stats ===
  // ==========================================
  get_usage_stats: {
    name: 'get_usage_stats',
    description: 'Get tool usage statistics including call counts, error rates, and hourly distribution.',
    category: ToolCategory.ANALYTICS,
    handler: analyticsTools.handleGetUsageStats,
    inputSchema: analyticsTools.GetUsageStatsSchema
  },
  get_recent_tool_calls: {
    name: 'get_recent_tool_calls',
    description: 'Get recent tool call history from the audit log. Useful for debugging.',
    category: ToolCategory.ANALYTICS,
    handler: analyticsTools.handleGetRecentToolCalls,
    inputSchema: analyticsTools.GetRecentToolCallsSchema
  },
  get_audit_log_stats: {
    name: 'get_audit_log_stats',
    description: 'Get audit log statistics including total entries and database size.',
    category: ToolCategory.ANALYTICS,
    handler: analyticsTools.handleGetAuditLogStats,
    inputSchema: analyticsTools.GetAuditLogStatsSchema
  },
  clear_old_logs: {
    name: 'clear_old_logs',
    description: 'Delete audit log entries older than specified days. Use dryRun=true to preview.',
    category: ToolCategory.ANALYTICS,
    handler: analyticsTools.handleClearOldLogs,
    inputSchema: analyticsTools.ClearOldLogsSchema,
    requiredFields: ['olderThanDays']
  },

  // ==========================================
  // === Paginated Search ===
  // ==========================================
  start_search: {
    name: 'start_search',
    description: 'Start a paginated file search. Returns searchId for retrieving results. Use for large directories.',
    category: ToolCategory.PAGINATED_SEARCH,
    handler: paginatedSearchTools.handleStartSearch,
    inputSchema: paginatedSearchTools.StartSearchSchema,
    requiredFields: ['directory', 'pattern']
  },
  get_search_results: {
    name: 'get_search_results',
    description: 'Get paginated results from a search session. Automatically advances cursor for next call.',
    category: ToolCategory.PAGINATED_SEARCH,
    handler: paginatedSearchTools.handleGetSearchResults,
    inputSchema: paginatedSearchTools.GetSearchResultsSchema,
    requiredFields: ['searchId']
  },
  list_active_searches: {
    name: 'list_active_searches',
    description: 'List all active search sessions with their status.',
    category: ToolCategory.PAGINATED_SEARCH,
    handler: paginatedSearchTools.handleListSearches,
    inputSchema: paginatedSearchTools.ListSearchesSchema
  },
  stop_search: {
    name: 'stop_search',
    description: 'Stop a search session and cleanup resources.',
    category: ToolCategory.PAGINATED_SEARCH,
    handler: paginatedSearchTools.handleStopSearch,
    inputSchema: paginatedSearchTools.StopSearchSchema,
    requiredFields: ['searchId']
  },

  // ==========================================
  // === Browser Automation ===
  // ==========================================
  launch_browser: {
    name: 'launch_browser',
    description: 'Launch a browser instance (Puppeteer or Playwright). Toggles headless mode.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleLaunchBrowser,
    inputSchema: browserTools.LaunchBrowserSchema
  },
  close_browser: {
    name: 'close_browser',
    description: 'Close the browser instance and cleanup.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleCloseBrowser,
    inputSchema: browserTools.CloseBrowserSchema
  },
  navigate_page: {
    name: 'navigate_page',
    description: 'Navigate to a URL and wait for load.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleNavigatePage,
    inputSchema: browserTools.NavigatePageSchema,
    requiredFields: ['url']
  },
  get_page_content: {
    name: 'get_page_content',
    description: 'Get page content in HTML, text, or markdown format.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleGetPageContent,
    inputSchema: browserTools.GetPageContentSchema
  },
  click_element: {
    name: 'click_element',
    description: 'Click an element identified by CSS/XPath selector.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleClickElement,
    inputSchema: browserTools.ClickElementSchema,
    requiredFields: ['selector']
  },
  type_text: {
    name: 'type_text',
    description: 'Type text into an input field.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleTypeText,
    inputSchema: browserTools.TypeTextSchema,
    requiredFields: ['selector', 'text']
  },
  evaluate_js: {
    name: 'evaluate_js',
    description: 'Execute JavaScript code in the page context.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleEvalJs,
    inputSchema: browserTools.EvalJsSchema,
    requiredFields: ['script']
  },
  screenshot_page: {
    name: 'screenshot_page',
    description: 'Capture a full-page screenshot (returns base64).',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleScreenshotPage,
    inputSchema: browserTools.ScreenshotPageSchema
  },
  get_console_logs: {
    name: 'get_console_logs',
    description: 'Retrieve captured console logs from the browser.',
    category: ToolCategory.BROWSER,
    handler: browserTools.handleGetConsoleLogs,
    inputSchema: browserTools.GetConsoleLogsSchema
  }
};

// Helper functions for working with ActionEnum

/**
 * Get all tool definitions grouped by category
 */
export function getToolsByCategory(): Record<string, ToolDefinition[]> {
  const grouped: Record<string, ToolDefinition[]> = {};
  
  Object.values(ToolCategory).forEach(category => {
    grouped[category] = [];
  });
  
  Object.values(ActionEnum).forEach(tool => {
    if (!grouped[tool.category]) {
      grouped[tool.category] = [];
    }
    grouped[tool.category].push(tool);
  });
  
  // Remove empty categories
  return Object.fromEntries(
    Object.entries(grouped).filter(([_, tools]) => tools.length > 0)
  );
}

/**
 * Get tool definition by name
 */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return ActionEnum[name];
}

/**
 * Validate that a tool name exists in the ActionEnum
 */
export function validateToolName(name: string): boolean {
  return name in ActionEnum;
}

/**
 * Get all available tool names
 */
export function getAllToolNames(): string[] {
  return Object.keys(ActionEnum);
}

/**
 * Audit function to check for tool registry consistency
 */
export function auditToolRegistry(): string[] {
  const issues: string[] = [];
  
  // Check for duplicate tool names
  const seenNames = new Set<string>();
  Object.values(ActionEnum).forEach(tool => {
    if (seenNames.has(tool.name)) {
      issues.push(`Duplicate tool name: ${tool.name}`);
    }
    seenNames.add(tool.name);
  });
  
  // Check for missing required fields
  Object.entries(ActionEnum).forEach(([name, tool]) => {
    if (!tool.name) {
      issues.push(`Tool ${name} missing name`);
    }
    if (!tool.description) {
      issues.push(`Tool ${name} missing description`);
    }
    if (!tool.category) {
      issues.push(`Tool ${name} missing category`);
    }
    if (!tool.handler) {
      issues.push(`Tool ${name} missing handler`);
    }
    if (!tool.inputSchema) {
      issues.push(`Tool ${name} missing inputSchema`);
    }
  });
  
  return issues;
}
