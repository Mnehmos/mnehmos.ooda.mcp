# mnehmos.ooda.mcp - Knowledge Base Document

## Quick Reference

| Property | Value |
|----------|-------|
| **Repository** | https://github.com/Mnehmos/mnehmos.ooda.mcp |
| **Primary Language** | TypeScript |
| **Project Type** | MCP Server |
| **Status** | Active |
| **Version** | 3.0.0 |
| **Last Updated** | 2025-01-10 |

## Overview

mnehmos.ooda.mcp is a comprehensive Model Context Protocol (MCP) server that provides full computer control capabilities to Claude AI. It implements the OODA loop (Observe-Orient-Decide-Act) pattern, enabling autonomous computer interaction through **100 tools** across 12 categories: CLI/filesystem operations, CRUD database, screen capture, input simulation, window management, clipboard operations, system utilities, browser automation, interactive sessions, diff-based editing, configuration management, and batch operations. This server allows AI agents to perceive, reason about, and interact with desktop environments in a structured, repeatable manner.

## Architecture

### System Design

The server follows the MCP (Model Context Protocol) architecture, acting as a bridge between Claude AI and the host operating system. It uses stdio transport for communication with Claude Desktop and exposes tools through standardized MCP protocol methods. The architecture implements:

- **MCP Server Pattern**: Uses @modelcontextprotocol/sdk for protocol compliance
- **Cross-Platform Abstraction**: Platform-specific implementations for Windows (PowerShell/Win32 API), macOS (osascript/screencapture), and Linux (xdotool/wmctrl)
- **Persistent Storage**: SQLite database for CRUD operations and audit logging
- **Generic Batch Dispatcher**: Universal `batch_tools` dispatcher that can execute ANY tool in batch mode with configurable safety limits
- **Diff-Based Editing**: Intelligent file editing with fuzzy matching, sequential multi-edit, and bulk line replacement
- **Browser Automation**: Integrated Playwright and Puppeteer for web automation tasks

### Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| Main Entry Point | MCP server initialization, tool registration, request routing | `src/index.ts` |
| CLI Tools | Shell command execution, file I/O, text manipulation | `src/tools/cli.ts` |
| CRUD Tools | SQLite-backed key-value store with collections | `src/tools/crud.ts` |
| Filesystem Tools | Copy, move, delete, search, metadata operations | `src/tools/filesystem.ts` |
| Screen Tools | Screenshot capture, display info, change detection, OCR | `src/tools/screen.ts` |
| Input Tools | Keyboard typing/shortcuts, mouse movement/clicking/scrolling | `src/tools/input.ts` |
| Window Tools | Window enumeration, focus, resize, minimize, launch apps | `src/tools/window.ts` |
| Clipboard Tools | Read/write text, HTML, images to system clipboard | `src/tools/clipboard.ts` |
| System Tools | Process management, environment vars, network info, notifications | `src/tools/system.ts` |
| Storage Layer | SQLite database wrapper for CRUD and audit logging | `src/storage/db.ts` |
| Config Manager | Configuration file loading and validation | `src/config.ts` |
| Browser Automation | Playwright and Puppeteer integration for web tasks | `src/tools/browser/` |
| Diff Tools | Intelligent file diffing, batch editing, line replacement | `src/tools/diff/` |
| Batch Dispatcher | Generic batch execution for any tool with safety limits | `src/tools/batchDispatcher.ts` |
| Analytics | Tool usage tracking and performance metrics | `src/tools/analytics.ts` |

### Data Flow

```
Claude Desktop Client
    ↓ (stdio transport)
MCP Server (index.ts)
    ↓ (tool call routing)
Tool Handlers (cli.ts, crud.ts, etc.)
    ↓ (platform detection)
OS-Specific Implementations
    ↓ (execute)
Operating System APIs
    - Windows: PowerShell, Win32 API
    - macOS: osascript, screencapture, pbcopy/pbpaste
    - Linux: xdotool, wmctrl, scrot, xclip
    ↓ (result)
Tool Handler (validation, formatting)
    ↓ (response)
MCP Server (protocol wrapping)
    ↓ (stdio)
Claude Desktop Client
```

**CRUD Flow**:
```
CRUD Tool Call → SQLite Database (kv_store table) → Audit Log → Result
```

**Batch Flow**:
```
Batch Tool Call → Promise.all(operations) → Aggregate Results → Summary + Individual Results
```

## API Surface

### Public Interfaces

The server exposes **100 tools** organized by category. All tools use Zod schemas for validation and JSON Schema for MCP protocol compliance.

#### Tool Category: CLI & File Operations (17 tools)

#### Tool: `exec_cli`
- **Purpose**: Execute arbitrary shell commands on the host system
- **Parameters**:
  - `command` (string): Shell command to execute
  - `cwd` (string, optional): Working directory for command execution
  - `timeout` (number, optional): Maximum execution time in milliseconds
- **Returns**: Object with `stdout`, `stderr`, `exitCode`, and `executionTime`

#### Tool: `read_file`
- **Purpose**: Read entire file contents as UTF-8 text
- **Parameters**:
  - `path` (string): Absolute or relative file path
- **Returns**: File contents as string

#### Tool: `write_file`
- **Purpose**: Write content to a file, creating or overwriting as needed
- **Parameters**:
  - `path` (string): Absolute or relative file path
  - `content` (string): Content to write to file
- **Returns**: Confirmation message with file path

#### Tool: `str_replace`
- **Purpose**: Find and replace text in a file using exact matching or regex
- **Parameters**:
  - `path` (string): File path to modify
  - `old_str` (string): Text to find (or regex pattern)
  - `new_str` (string): Replacement text
  - `use_regex` (boolean, optional): Whether to treat old_str as regex
- **Returns**: Number of replacements made and preview of changes

#### Tool: `batch_exec_cli`
- **Purpose**: Execute multiple shell commands in parallel
- **Parameters**:
  - `operations` (array): Array of objects with `command`, `cwd`, `timeout` properties
- **Returns**: Summary object with `total`, `successful`, `failed`, `elapsed_ms` plus individual results

#### Tool Category: CRUD Operations (9 tools)

#### Tool: `crud_create`
- **Purpose**: Create a new record in a collection with auto-generated UUID
- **Parameters**:
  - `collection` (string): Collection name (like a table)
  - `data` (any): JSON object to store
- **Returns**: Object with generated `id` and stored `data`

#### Tool: `crud_read`
- **Purpose**: Retrieve a specific record by ID from a collection
- **Parameters**:
  - `collection` (string): Collection name
  - `id` (string): Record UUID
- **Returns**: Stored data object or error if not found

#### Tool: `crud_update`
- **Purpose**: Update an existing record by ID, merging new data
- **Parameters**:
  - `collection` (string): Collection name
  - `id` (string): Record UUID
  - `data` (any): New data to merge with existing record
- **Returns**: Updated data object

#### Tool: `crud_delete`
- **Purpose**: Delete a record from a collection
- **Parameters**:
  - `collection` (string): Collection name
  - `id` (string): Record UUID
- **Returns**: Confirmation message

#### Tool: `crud_query`
- **Purpose**: Query records in a collection with optional filtering
- **Parameters**:
  - `collection` (string): Collection name
  - `filter` (object, optional): JSON filter criteria
  - `limit` (number, optional): Maximum results to return
- **Returns**: Array of matching records with `id`, `data`, `created_at`, `updated_at`

#### Tool: `crud_batch_create`
- **Purpose**: Create multiple records in parallel across collections
- **Parameters**:
  - `operations` (array): Array of `{collection, data}` objects
- **Returns**: Batch summary plus array of created records with IDs

#### Tool Category: Screen Operations (4 tools)

#### Tool: `screenshot`
- **Purpose**: Capture screen or region, return as base64 or save to file
- **Parameters**:
  - `region` (object, optional): `{x, y, width, height}` for partial capture
  - `save_path` (string, optional): Path to save PNG file
  - `display` (number, optional): Display/monitor index to capture
- **Returns**: Base64-encoded PNG image data or file path if save_path provided

#### Tool: `get_screen_info`
- **Purpose**: Get information about displays, resolution, scaling
- **Parameters**: None
- **Returns**: Array of display objects with `width`, `height`, `scaleFactor`, `primary` flag

#### Tool: `wait_for_screen_change`
- **Purpose**: Poll screen until visual change detected or timeout
- **Parameters**:
  - `region` (object, optional): Region to monitor
  - `timeout` (number, optional): Maximum wait time in milliseconds
  - `interval` (number, optional): Polling interval in milliseconds
- **Returns**: Object indicating if change was detected and elapsed time

#### Tool: `find_on_screen`
- **Purpose**: Find text or image pattern on screen using OCR (requires additional dependencies)
- **Parameters**:
  - `target` (string): Text to find or path to image template
  - `type` (string): "text" or "image"
- **Returns**: Coordinates of match or null if not found

#### Tool Category: Input Simulation (10 tools)

#### Tool: `keyboard_type`
- **Purpose**: Type a string of text as keyboard input
- **Parameters**:
  - `text` (string): Text to type
  - `delay_ms` (number, optional): Delay between keystrokes
- **Returns**: Confirmation message

#### Tool: `keyboard_shortcut`
- **Purpose**: Execute keyboard shortcut like Ctrl+C or Cmd+V
- **Parameters**:
  - `shortcut` (string): Shortcut string (e.g., "ctrl+c", "cmd+v", "alt+tab")
- **Returns**: Confirmation message

#### Tool: `mouse_move`
- **Purpose**: Move mouse cursor to absolute screen coordinates
- **Parameters**:
  - `x` (number): X coordinate
  - `y` (number): Y coordinate
- **Returns**: Confirmation message

#### Tool: `mouse_click`
- **Purpose**: Click mouse button at current or specified position
- **Parameters**:
  - `x` (number, optional): X coordinate
  - `y` (number, optional): Y coordinate
  - `button` (string, optional): "left", "right", or "middle" (default: "left")
  - `clicks` (number, optional): Number of clicks (default: 1)
- **Returns**: Confirmation message

#### Tool: `mouse_drag`
- **Purpose**: Click and drag mouse from one point to another
- **Parameters**:
  - `from_x` (number): Starting X coordinate
  - `from_y` (number): Starting Y coordinate
  - `to_x` (number): Ending X coordinate
  - `to_y` (number): Ending Y coordinate
- **Returns**: Confirmation message

#### Tool: `mouse_scroll`
- **Purpose**: Scroll mouse wheel vertically or horizontally
- **Parameters**:
  - `amount` (number): Scroll amount (positive = down/right, negative = up/left)
  - `direction` (string, optional): "vertical" or "horizontal" (default: "vertical")
- **Returns**: Confirmation message

#### Tool: `batch_keyboard_actions`
- **Purpose**: Execute sequence of keyboard actions in order
- **Parameters**:
  - `actions` (array): Array of action objects with `type` ("type", "press", "shortcut") and action-specific parameters
- **Returns**: Batch summary with individual action results

#### Tool: `batch_mouse_actions`
- **Purpose**: Execute sequence of mouse actions in order
- **Parameters**:
  - `actions` (array): Array of action objects with `type` ("move", "click", "drag", "scroll") and action-specific parameters
- **Returns**: Batch summary with individual action results

#### Tool Category: Window Management (10 tools)

#### Tool: `list_windows`
- **Purpose**: Get list of all open windows with titles and IDs
- **Parameters**: None
- **Returns**: Array of window objects with `id`, `title`, `processName`, `bounds` (x, y, width, height)

#### Tool: `get_active_window`
- **Purpose**: Get information about currently focused window
- **Parameters**: None
- **Returns**: Window object with `id`, `title`, `processName`, `bounds`

#### Tool: `focus_window`
- **Purpose**: Bring window to front and give it keyboard focus
- **Parameters**:
  - `window_id` (string, optional): Window ID from list_windows
  - `title_pattern` (string, optional): Regex pattern to match window title
- **Returns**: Confirmation message

#### Tool: `launch_application`
- **Purpose**: Launch application by path or name
- **Parameters**:
  - `application` (string): Application path or name
  - `args` (array, optional): Command-line arguments
- **Returns**: Confirmation message with process ID

#### Tool: `close_window`
- **Purpose**: Close specified window
- **Parameters**:
  - `window_id` (string, optional): Window ID
  - `title_pattern` (string, optional): Window title pattern
- **Returns**: Confirmation message

#### Tool Category: Clipboard Operations (4 tools)

#### Tool: `clipboard_read`
- **Purpose**: Read current clipboard contents (text, HTML, or image)
- **Parameters**:
  - `format` (string, optional): "text", "html", or "image" (default: "text")
- **Returns**: Clipboard contents in requested format (base64 for images)

#### Tool: `clipboard_write`
- **Purpose**: Write content to system clipboard
- **Parameters**:
  - `content` (string): Content to write
  - `format` (string, optional): "text" or "html" (default: "text")
- **Returns**: Confirmation message

#### Tool: `clipboard_clear`
- **Purpose**: Clear clipboard contents
- **Parameters**: None
- **Returns**: Confirmation message

#### Tool Category: System Operations (8 tools)

#### Tool: `get_system_info`
- **Purpose**: Get system information (OS, CPU, memory, uptime)
- **Parameters**: None
- **Returns**: Object with `platform`, `arch`, `cpus`, `totalMemory`, `freeMemory`, `uptime`

#### Tool: `list_processes`
- **Purpose**: List running processes with PID, name, and resource usage
- **Parameters**:
  - `filter` (string, optional): Process name filter pattern
- **Returns**: Array of process objects

#### Tool: `kill_process`
- **Purpose**: Terminate process by PID or name
- **Parameters**:
  - `pid` (number, optional): Process ID
  - `name` (string, optional): Process name
- **Returns**: Confirmation message

#### Tool: `notify`
- **Purpose**: Display system notification to user
- **Parameters**:
  - `title` (string): Notification title
  - `message` (string): Notification body text
- **Returns**: Confirmation message

#### Tool Category: Generic Batch Operations (1 tool)

#### Tool: `batch_tools`
- **Purpose**: Universal batch dispatcher that can execute ANY tool in batch mode with unified safety limits
- **Parameters**:
  - `operations` (array): Array of `{tool, args, label?}` objects specifying tools to execute
  - `executionMode` (string, optional): `"parallel"` (default) or `"sequential"`
  - `stopOnError` (boolean, optional): Stop sequential execution on first error (default: false)
  - `timeout` (number, optional): Per-operation timeout in milliseconds
  - `safetyLimits` (object, optional): Override default limits `{maxOperations, maxAggregateChars, maxLinesPerFile}`
- **Returns**: Summary object with `total`, `successful`, `failed`, `elapsed_ms`, `warnings` plus individual results
- **Safety Limits**:
  - `maxOperations`: 50 (max operations per batch)
  - `maxAggregateChars`: 200000 (total output size limit)
  - `maxLinesPerFile`: 500 (per-file line truncation)
  - `timeout`: 30000 (per-operation timeout in ms)

#### Tool Category: Diff-Based Editing (5 tools)

#### Tool: `edit_block`
- **Purpose**: Search/replace with fuzzy matching fallback when exact match fails
- **Parameters**:
  - `path` (string): File path to edit
  - `search` (string): Text to search for
  - `replace` (string): Replacement text
  - `expectedReplacements` (number, optional): Expected occurrences (default: 1)
  - `dryRun` (boolean, optional): Preview changes without applying
  - `fuzzyThreshold` (number, optional): Similarity threshold for fuzzy matching (default: 0.7)
- **Returns**: Object with success status, diff preview, and match information

#### Tool: `batch_edit_blocks`
- **Purpose**: Apply multiple search/replace operations to a single file sequentially with partial success support
- **Parameters**:
  - `path` (string): File path to edit
  - `edits` (array): Array of `{search, replace, label?, expectedReplacements?}` objects
  - `stopOnError` (boolean, optional): Stop on first failure, save completed work (default: false)
  - `dryRun` (boolean, optional): Preview changes without applying (default: false)
  - `fuzzyThreshold` (number, optional): Similarity threshold (default: 0.7)
- **Returns**: Object with `success`, `totalEdits`, `successfulEdits`, `failedEdits`, per-edit `results`, and `finalDiff`

#### Tool: `write_from_line`
- **Purpose**: Replace content starting from a specific line number to EOF or specified endLine
- **Parameters**:
  - `path` (string): File path to edit
  - `startLine` (number): First line to replace (1-indexed, inclusive)
  - `endLine` (number, optional): Last line to replace (1-indexed). If omitted, replaces to EOF
  - `content` (string): New content to write
  - `dryRun` (boolean, optional): Preview changes without applying (default: false)
- **Returns**: Object with `success`, `message`, `linesReplaced`, `newLineCount`, and `diff`

#### Tool: `apply_diff`
- **Purpose**: Apply multiple search/replace blocks to a file atomically
- **Parameters**:
  - `path` (string): File path to edit
  - `diffs` (array): Array of `{search, replace, startLine?}` blocks
  - `dryRun` (boolean, optional): Preview changes without applying
  - `allowFuzzy` (boolean, optional): Allow fuzzy matching fallback (default: true)
  - `fuzzyThreshold` (number, optional): Similarity threshold (default: 0.7)
- **Returns**: Diff preview and success status

#### Tool: `get_diff_preview`
- **Purpose**: Generate diff preview without modifying file
- **Parameters**:
  - `path` (string): File path
  - `search` (string): Text to search for
  - `replace` (string): Replacement text
  - `format` (string, optional): `"unified"`, `"inline"`, or `"sidebyside"` (default: unified)
  - `contextLines` (number, optional): Lines of context around changes (default: 3)
- **Returns**: Formatted diff preview

### Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `storage.type` | string | `"sqlite"` | Storage backend type (currently only sqlite) |
| `storage.path` | string | `"~/.mcp/workspace.db"` | SQLite database file path |
| `cliPolicy.mode` | string | `"allow-all"` | CLI execution policy (allow-all or restricted) |
| `cliPolicy.extraBlockedPatterns` | array | `[]` | Additional regex patterns to block in CLI commands |
| `cliPolicy.timeoutMs` | number | `30000` | Default timeout for CLI command execution |
| `crud.defaultLimit` | number | `1000` | Default query result limit for CRUD operations |
| `fileReading.maxLines` | number | `500` | Maximum lines to read per file in batch operations |
| `fileReading.warnAtLines` | number | `100` | Warn when file exceeds this many lines |
| `batchOperations.maxOperations` | number | `50` | Maximum operations per batch_tools call |
| `batchOperations.maxAggregateChars` | number | `200000` | Total output size limit for batch results |
| `batchOperations.maxLinesPerFile` | number | `500` | Per-file line truncation in batch reads |
| `batchOperations.defaultTimeout` | number | `30000` | Per-operation timeout in milliseconds |
| `batchOperations.toolLimits` | object | `{}` | Per-tool limit overrides (e.g., `{"exec_cli": {"maxOperations": 20}}`) |

Configuration file location: `~/.mcp/config.json` (optional)

## Usage Examples

### Basic Usage: OODA Loop Workflow

```typescript
// OBSERVE: Take a screenshot to see current state
const screenshot = await mcpClient.callTool('screenshot', {});
// Returns base64 PNG image that Claude can analyze

// OBSERVE: Get list of open windows
const windows = await mcpClient.callTool('list_windows', {});
// Returns: [{ id: "123", title: "Visual Studio Code", processName: "Code.exe", bounds: {...} }, ...]

// ORIENT: Store context in CRUD database
await mcpClient.callTool('crud_create', {
  collection: 'workflow_state',
  data: {
    task: 'edit_document',
    target_window: windows.find(w => w.title.includes('Notepad')).id,
    timestamp: Date.now()
  }
});

// DECIDE: Query previous decisions
const history = await mcpClient.callTool('crud_query', {
  collection: 'workflow_state',
  filter: { task: 'edit_document' },
  limit: 10
});

// ACT: Focus window and type text
await mcpClient.callTool('focus_window', {
  title_pattern: 'Notepad'
});

await mcpClient.callTool('keyboard_type', {
  text: 'Hello from Claude AI!',
  delay_ms: 50
});
```

### Advanced Pattern: Batch File Processing

```typescript
// Read multiple configuration files in parallel
const configFiles = [
  'package.json',
  'tsconfig.json',
  '.env.example'
];

const batchResults = await mcpClient.callTool('batch_read_files', {
  operations: configFiles.map(path => ({ path }))
});

// Returns:
// {
//   summary: { total: 3, successful: 3, failed: 0, elapsed_ms: 45 },
//   results: [
//     { index: 0, success: true, result: { content: "{...}" } },
//     { index: 1, success: true, result: { content: "{...}" } },
//     { index: 2, success: true, result: { content: "API_KEY=..." } }
//   ]
// }

// Process the results
const packageJson = JSON.parse(
  batchResults.results.find(r => r.index === 0).result.content
);

// Update all files in parallel
await mcpClient.callTool('batch_write_files', {
  operations: [
    { path: 'package.json', content: JSON.stringify(packageJson, null, 2) },
    { path: 'README.md', content: '# Updated Project\n\nNew content...' },
    { path: 'VERSION', content: packageJson.version }
  ]
});
```

### Advanced Pattern: Automated UI Testing

```typescript
// Automated browser interaction workflow
async function testWebApplication() {
  // 1. Launch browser
  await mcpClient.callTool('launch_application', {
    application: 'chrome',
    args: ['--new-window', 'http://localhost:3000']
  });

  // 2. Wait for page load
  await mcpClient.callTool('wait', { duration_ms: 2000 });

  // 3. Take baseline screenshot
  const baseline = await mcpClient.callTool('screenshot', {
    save_path: './test_screenshots/baseline.png'
  });

  // 4. Execute test actions in sequence
  await mcpClient.callTool('batch_mouse_actions', {
    actions: [
      { type: 'move', x: 100, y: 200 },
      { type: 'click', button: 'left', clicks: 1 },
      { type: 'scroll', amount: -3, direction: 'vertical' }
    ]
  });

  // 5. Type form data
  await mcpClient.callTool('batch_keyboard_actions', {
    actions: [
      { type: 'type', text: 'test@example.com' },
      { type: 'shortcut', shortcut: 'tab' },
      { type: 'type', text: 'SecurePassword123' },
      { type: 'shortcut', shortcut: 'enter' }
    ]
  });

  // 6. Wait for UI change
  await mcpClient.callTool('wait_for_screen_change', {
    timeout: 5000,
    interval: 500
  });

  // 7. Capture result
  const result = await mcpClient.callTool('screenshot', {
    save_path: './test_screenshots/result.png'
  });

  // 8. Store test results in CRUD
  await mcpClient.callTool('crud_create', {
    collection: 'test_runs',
    data: {
      test_name: 'login_flow',
      timestamp: Date.now(),
      baseline_screenshot: baseline,
      result_screenshot: result,
      status: 'completed'
    }
  });
}
```

## Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @modelcontextprotocol/sdk | ^0.6.0 | MCP protocol implementation and server framework |
| sqlite | ^5.0.1 | Promise-based SQLite wrapper for CRUD operations |
| sqlite3 | ^5.1.6 | Native SQLite3 bindings |
| uuid | ^13.0.0 | UUID generation for CRUD record IDs |
| zod | ^3.22.0 | Runtime schema validation for tool parameters |
| zod-to-json-schema | ^3.25.0 | Convert Zod schemas to JSON Schema for MCP protocol |
| fastest-levenshtein | ^1.0.16 | Fuzzy string matching for text search |
| playwright | ^1.57.0 | Browser automation (Chromium, Firefox, WebKit) |
| puppeteer | ^24.32.0 | Headless Chrome automation |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.0.0 | TypeScript compiler and language support |
| @types/node | ^20.0.0 | TypeScript definitions for Node.js APIs |
| @types/sqlite3 | ^3.1.8 | TypeScript definitions for sqlite3 |
| @types/uuid | ^10.0.0 | TypeScript definitions for uuid |
| @types/puppeteer | ^5.4.7 | TypeScript definitions for Puppeteer |

### System Requirements

- **Node.js**: >= 18.0.0
- **Operating Systems**: Windows 10+, macOS 10.14+, Linux (Ubuntu 20.04+)

### Platform-Specific Dependencies

**Windows**:
- PowerShell 5.1+ (built-in)
- .NET Framework for Win32 API calls

**macOS**:
- osascript (built-in)
- screencapture (built-in)
- pbcopy/pbpaste (built-in)

**Linux**:
- xdotool (`sudo apt install xdotool`)
- wmctrl (`sudo apt install wmctrl`)
- scrot (`sudo apt install scrot`)
- xclip (`sudo apt install xclip`)

## Integration Points

### Works With

| Project | Integration Type | Description |
|---------|-----------------|-------------|
| Claude Desktop | Primary Client | This MCP server is designed for Claude Desktop app integration |
| mnehmos.trace.mcp | Peer | Can be used alongside Trace MCP for debugging workflow executions |
| mnehmos.synch.mcp | Peer | Can work with Synch MCP for synchronized multi-system operations |
| mnehmos.sight.mcp | Peer | Complements Sight MCP by providing action capabilities to vision analysis |

### External Services

| Service | Purpose | Required |
|---------|---------|----------|
| Local Operating System APIs | All computer control functionality | Yes |
| SQLite | Persistent storage for CRUD operations and audit logs | Yes |
| OCR Engine | find_on_screen text detection (not included) | No |
| Playwright/Puppeteer Browsers | Web automation capabilities | No (optional feature) |

## Development Guide

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn package manager
- Git for version control
- Platform-specific tools (see System Requirements)

### Setup

```bash
# Clone the repository
git clone https://github.com/Mnehmos/mnehmos.ooda.mcp.git
cd mnehmos.ooda.mcp

# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build
```

### Running Locally

```bash
# Development mode with auto-rebuild
npm run dev

# Production build
npm run build

# Run the built server
npm start
```

### Testing

```bash
# Manual testing with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Test individual tools
node test_capabilities.js

# Test batch operations
node test_diff_tools.js
```

### Building

```bash
# Build for production
npm run build

# Output location
dist/index.js (main entry point)
dist/tools/ (compiled tool modules)
dist/storage/ (compiled storage modules)
```

### Claude Desktop Integration

1. Build the project: `npm run build`
2. Locate Claude Desktop config file:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Add server configuration:

```json
{
  "mcpServers": {
    "ooda-computer": {
      "command": "node",
      "args": ["F:\\Github\\mnehmos.ooda.mcp\\dist\\index.js"]
    }
  }
}
```

4. Restart Claude Desktop
5. Verify tools appear in Claude interface

## Maintenance Notes

### Known Issues

1. **macOS mouse position**: `get_mouse_position` returns (0, 0) on macOS due to system security restrictions requiring Accessibility permissions
2. **find_on_screen OCR**: Requires additional OCR engine installation (Tesseract) not included in package dependencies
3. **Mouse drag timing**: Some applications may require platform-specific timing adjustments for drag operations to register correctly
4. **Linux window IDs**: Window ID format varies between window managers, may require adaptation for non-standard WMs
5. **Batch operation limits**: Very large batch operations (100+ items) may hit OS resource limits; consider chunking

### Future Considerations

1. **Enhanced OCR**: Bundle Tesseract or use cloud OCR services for find_on_screen reliability
2. **Record/Replay**: Add session recording capability to capture and replay OODA loop sequences
3. **Visual Regression Testing**: Built-in screenshot comparison tools for automated UI testing
4. **Remote Execution**: Support for controlling remote machines via SSH/RDP
5. **Permission System**: Granular permission model for restricting tool access in untrusted scenarios
6. **Performance Monitoring**: Built-in metrics dashboard for analyzing tool usage patterns and bottlenecks
7. **Mobile Device Support**: Android/iOS automation via ADB/XCUITest integration

### Code Quality

| Metric | Status |
|--------|--------|
| Tests | Automated tests for diff tools (batchEditBlocks, writeFromLine) |
| Linting | None configured |
| Type Safety | TypeScript strict mode enabled |
| Documentation | JSDoc comments on major functions, comprehensive README, ADRs |

---

## Appendix: File Structure

```
mnehmos.ooda.mcp/
├── src/
│   ├── index.ts                 # MCP server entry point, tool registration
│   ├── config.ts                # Configuration file loading and validation
│   ├── audit.ts                 # Audit logging for tool execution tracking
│   ├── storage/
│   │   └── db.ts                # SQLite database initialization and access
│   ├── tools/
│   │   ├── cli.ts               # Shell commands and file I/O operations
│   │   ├── crud.ts              # CRUD database operations
│   │   ├── filesystem.ts        # File copy, move, delete, search
│   │   ├── screen.ts            # Screenshot, display info, change detection
│   │   ├── input.ts             # Keyboard and mouse simulation
│   │   ├── window.ts            # Window management and application launching
│   │   ├── clipboard.ts         # Clipboard read/write operations
│   │   ├── system.ts            # System info, processes, notifications
│   │   ├── browser/             # Browser automation subsystem
│   │   │   ├── tools.ts         # Browser tool implementations
│   │   │   ├── browserManager.ts # Browser instance lifecycle management
│   │   │   ├── interfaces.ts    # TypeScript interfaces for browser types
│   │   │   └── providers/       # Playwright and Puppeteer implementations
│   │   ├── diff/                # File diffing and intelligent text replacement
│   │   │   ├── index.ts         # Diff tool exports
│   │   │   ├── applyDiff.ts     # Apply diff patches to files
│   │   │   ├── editBlock.ts     # Block-based editing with fuzzy matching
│   │   │   ├── batchEditBlocks.ts # Sequential multi-edit with partial success
│   │   │   ├── writeFromLine.ts # Bulk line replacement from line N
│   │   │   ├── fuzzySearch.ts   # Fuzzy string matching for resilient edits
│   │   │   ├── diffVisualizer.ts # Diff formatting and visualization
│   │   │   ├── lineEndings.ts   # Line ending detection and normalization
│   │   │   ├── schemas.ts       # Zod schemas for diff operations
│   │   │   └── *.test.ts        # Unit tests for diff tools
│   │   ├── batchDispatcher.ts   # Generic batch tool executor with safety limits
│   │   ├── batchTools.ts        # Batch tool schema exports
│   │   ├── analytics.ts         # Tool usage analytics and metrics
│   │   ├── configTools.ts       # Runtime config query tools
│   │   ├── executeCode.ts       # Dynamic code execution (eval)
│   │   ├── paginatedSearch.ts   # Large file search with pagination
│   │   └── sessions.ts          # Session management for stateful workflows
│   └── utils/
│       └── powerShellSession.ts # PowerShell session pooling for Windows
├── dist/                        # Compiled JavaScript output (gitignored)
├── docs/                        # Documentation and architecture decision records
│   ├── ADR-002-batch-editing-tools.md # ADR for batch_edit_blocks, write_from_line
│   └── ADR-003-generic-batch-tools.md # ADR for batch_tools dispatcher
├── package.json                 # npm package manifest with dependencies
├── tsconfig.json                # TypeScript compiler configuration
├── README.md                    # User-facing documentation
├── CHANGELOG.md                 # Version history and release notes
├── LICENSE                      # MIT License
└── PROJECT_KNOWLEDGE.md         # This document
```

---

*Generated by Project Review Orchestrator | 2025-12-29*
*Source: https://github.com/Mnehmos/mnehmos.ooda.mcp*
