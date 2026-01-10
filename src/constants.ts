/**
 * Centralized constants for the OODA MCP server
 *
 * Timeout values can be overridden via ~/.mcp/config.json
 * under the cliPolicy.timeoutMs setting.
 */

/**
 * Default timeout values in milliseconds
 * These are used when no config override is specified
 */
export const TIMEOUTS = {
    /** Default timeout for simple shell commands (clipboard, notifications) */
    SHELL_COMMAND: 5000,

    /** Default timeout for screenshot operations */
    SCREENSHOT: 10000,

    /** Default timeout for window operations (focus, minimize, etc.) */
    WINDOW_OPERATION: 5000,

    /** Default timeout for browser element interactions */
    BROWSER_ELEMENT: 5000,

    /** Default timeout for wait_for_window */
    WAIT_FOR_WINDOW: 5000,

    /** Default timeout for wait_for_screen_change */
    WAIT_FOR_SCREEN_CHANGE: 5000,

    /** Default timeout for CLI command execution */
    CLI_COMMAND: 120000,
} as const;

/**
 * Safety limits for batch operations
 */
export const BATCH_LIMITS = {
    /** Maximum operations per batch_tools call */
    MAX_OPERATIONS: 50,

    /** Maximum aggregate output characters */
    MAX_AGGREGATE_CHARS: 200000,

    /** Maximum lines per file in batch reads */
    MAX_LINES_PER_FILE: 500,
} as const;

/**
 * Buffer sizes
 */
export const BUFFERS = {
    /** Maximum output characters before truncation */
    MAX_OUTPUT_CHARS: 50000,

    /** Minimum buffer limit */
    MIN_BUFFER_LIMIT: 5000,
} as const;

export type TimeoutKey = keyof typeof TIMEOUTS;
export type BatchLimitKey = keyof typeof BATCH_LIMITS;
export type BufferKey = keyof typeof BUFFERS;
