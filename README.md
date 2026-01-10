# mnehmos.ooda.mcp (v1.0.0)

[![npm version](https://img.shields.io/npm/v/mnehmos.ooda.mcp.svg)](https://www.npmjs.com/package/mnehmos.ooda.mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive MCP (Model Context Protocol) server that provides full computer control capabilities to Claude. Implements the OODA loop (Observe-Orient-Decide-Act) pattern for autonomous computer interaction.

## Features

| Category | Tools | Description |
|----------|-------|-------------|
| **CLI & Files** | 23 | Shell commands, file read/write/copy/move/delete, search, diff editing |
| **CRUD Database** | 9 | Persistent SQLite key-value store with collections |
| **Screen (Observe)** | 4 | Screenshot, display info, screen change detection |
| **Input (Act)** | 10 | Keyboard typing/shortcuts, mouse move/click/drag/scroll |
| **Window Management** | 11 | List/focus/minimize/maximize/close windows, launch apps |
| **Clipboard** | 4 | Read/write text, HTML, images |
| **System** | 8 | System info, processes, network, notifications |
| **Browser** | 9 | Puppeteer/Playwright automation |
| **Sessions** | 5 | Interactive process sessions (REPLs, SSH) |
| **Config & Analytics** | 7 | Configuration management, usage stats |
| **Search** | 4 | Paginated file search |
| **Generic Batch** | 1 | Universal batch dispatcher for any tool |

**Total: 100 tools** with batch/parallel execution support for most operations.

## Security Warning

This server provides **unrestricted system access**. Claude will be able to:
- Execute arbitrary shell commands
- Control keyboard and mouse
- Take screenshots
- Read/write files anywhere
- Manage windows and processes

**Use at your own risk in trusted environments only.**

## Installation

### From npm (Recommended)

```bash
npm install -g mnehmos.ooda.mcp
```

### From Source

```bash
git clone https://github.com/Mnehmos/mnehmos.ooda.mcp.git
cd mnehmos.ooda.mcp
npm install
npm run build
```

## Claude Desktop Configuration

Add to your Claude Desktop config file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

### If installed via npm:

```json
{
  "mcpServers": {
    "ooda-computer": {
      "command": "npx",
      "args": ["mnehmos.ooda.mcp"]
    }
  }
}
```

### If installed from source:

```json
{
  "mcpServers": {
    "ooda-computer": {
      "command": "node",
      "args": ["/absolute/path/to/mnehmos.ooda.mcp/dist/index.js"]
    }
  }
}
```

## OODA Loop Pattern

The tools are designed around the OODA (Observe-Orient-Decide-Act) loop:

### Observe
- `screenshot` - Capture screen or region (returns base64 or saves to file)
- `get_screen_info` - Get display/monitor information
- `wait_for_screen_change` - Detect when screen content changes
- `list_windows` - See all open applications
- `get_active_window` - Know current focus
- `clipboard_read` - Check clipboard contents

### Orient
- Use CRUD tools to store/retrieve context and state
- `file_info`, `search_files` - Understand filesystem state
- `list_processes`, `get_system_info` - Understand system state

### Decide
- Built into Claude's reasoning between observations
- CRUD database for persistent decision context

### Act
- `keyboard_type`, `keyboard_shortcut` - Type and use hotkeys
- `mouse_click`, `mouse_move`, `mouse_drag` - Mouse control
- `focus_window`, `launch_application` - Window control
- `clipboard_write` - Set clipboard content
- `notify` - System notifications

## Generic Batch Dispatcher

The `batch_tools` dispatcher can execute ANY tool in batch mode with unified safety limits:

```json
{
  "tool": "batch_tools",
  "args": {
    "operations": [
      { "tool": "read_file", "args": { "path": "src/index.ts" }, "label": "main" },
      { "tool": "file_info", "args": { "path": "package.json" }, "label": "pkg" },
      { "tool": "exec_cli", "args": { "command": "git status --short" }, "label": "git" }
    ],
    "executionMode": "parallel"
  }
}
```

### Execution Modes

| Mode | Description |
|------|-------------|
| `parallel` | All operations run concurrently (default) |
| `sequential` | Operations run one after another, supports `stopOnError` |

### Safety Limits

Configurable via `~/.mcp/config.json` or per-request:

| Limit | Default | Description |
|-------|---------|-------------|
| `maxOperations` | 50 | Max operations per batch |
| `maxAggregateChars` | 200000 | Total output size limit |
| `maxLinesPerFile` | 500 | Per-file line truncation |
| `timeout` | 30000 | Per-operation timeout (ms) |

See [ADR-003](docs/ADR-003-generic-batch-tools.md) for full documentation.

## API Reference

### CLI & File Operations

| Tool | Description |
|------|-------------|
| `exec_cli` | Execute shell command |
| `read_file` | Read file contents |
| `write_file` | Write content to file |
| `list_directory` | List directory contents |
| `read_file_lines` | Read specific line range (token-efficient) |
| `search_in_file` | Search patterns within a file |
| `str_replace` | Replace unique string in file |
| `copy_file` | Copy file/directory |
| `move_file` | Move/rename file |
| `delete_file` | Delete file/directory |
| `file_info` | Get file metadata |
| `search_files` | Search files by pattern |
| `batch_*` | Parallel versions of above |

### Diff-Based Editing

| Tool | Description |
|------|-------------|
| `edit_block` | Search/replace with fuzzy matching fallback |
| `apply_diff` | Multiple search/replace in atomic operation |
| `get_diff_preview` | Preview changes without applying |
| `batch_edit_blocks` | Sequential edits with partial success |
| `write_from_line` | Replace content from line N to EOF |

### CRUD Operations

| Tool | Description |
|------|-------------|
| `crud_create` | Create record in collection |
| `crud_read` | Read record by ID |
| `crud_update` | Update existing record |
| `crud_delete` | Delete record |
| `crud_query` | Query with filters |
| `crud_batch_*` | Parallel versions |

### Screen Operations

| Tool | Description |
|------|-------------|
| `screenshot` | Capture screen (region optional) |
| `get_screen_info` | Display/monitor info |
| `wait_for_screen_change` | Wait for UI changes |
| `find_on_screen` | Find text/image (requires OCR) |

### Input Operations

| Tool | Description |
|------|-------------|
| `keyboard_type` | Type text |
| `keyboard_press` | Press key with modifiers |
| `keyboard_shortcut` | Execute shortcut (e.g., "ctrl+c") |
| `mouse_move` | Move cursor |
| `mouse_click` | Click at position |
| `mouse_drag` | Drag between points |
| `mouse_scroll` | Scroll wheel |
| `get_mouse_position` | Current cursor position |
| `batch_keyboard_actions` | Sequence of keyboard actions |
| `batch_mouse_actions` | Sequence of mouse actions |

### Window Operations

| Tool | Description |
|------|-------------|
| `list_windows` | All open windows |
| `get_active_window` | Currently focused window |
| `focus_window` | Bring window to front |
| `minimize_window` | Minimize window(s) |
| `maximize_window` | Maximize window |
| `restore_window` | Restore from min/max |
| `close_window` | Close window |
| `resize_window` | Resize window |
| `move_window` | Move window position |
| `launch_application` | Start application |
| `wait_for_window` | Wait for window to appear |

### Clipboard Operations

| Tool | Description |
|------|-------------|
| `clipboard_read` | Read text/HTML/image |
| `clipboard_write` | Write text/HTML |
| `clipboard_clear` | Clear clipboard |
| `clipboard_has_format` | Check format availability |

### System Operations

| Tool | Description |
|------|-------------|
| `get_system_info` | OS, CPU, memory, uptime |
| `list_processes` | Running processes |
| `kill_process` | Kill by PID or name |
| `get_environment` | Environment variables |
| `set_environment` | Set environment variable |
| `get_network_info` | Network interfaces |
| `wait` | Sleep for milliseconds |
| `notify` | System notification |

### Browser Automation

| Tool | Description |
|------|-------------|
| `launch_browser` | Start Puppeteer/Playwright browser |
| `close_browser` | Close browser instance |
| `navigate_page` | Navigate to URL |
| `get_page_content` | Get page HTML/text/markdown |
| `click_element` | Click element by selector |
| `type_text` | Type into input field |
| `evaluate_js` | Execute JavaScript |
| `screenshot_page` | Capture page screenshot |
| `get_console_logs` | Get browser console logs |

### Interactive Sessions

| Tool | Description |
|------|-------------|
| `start_process` | Start interactive process (REPL, SSH) |
| `interact_with_process` | Send input to process |
| `read_process_output` | Read process stdout |
| `list_sessions` | List active sessions |
| `terminate_process` | End process session |

## Batch Operations

Most tools have dedicated batch versions for parallel execution:

```
batch_exec_cli      - Multiple commands in parallel
batch_read_files    - Multiple files in parallel
batch_write_files   - Multiple files in parallel
batch_copy_files    - Multiple copies in parallel
crud_batch_create   - Multiple records in parallel
...
```

Or use the generic `batch_tools` dispatcher to batch ANY tool.

Batch operations return structured results:
```json
{
  "summary": { "total": 5, "successful": 4, "failed": 1, "elapsed_ms": 23 },
  "results": [
    { "index": 0, "success": true, "result": {...} },
    { "index": 1, "success": false, "error": "..." }
  ]
}
```

## Platform Support

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| CLI/Files | ✅ | ✅ | ✅ |
| CRUD | ✅ | ✅ | ✅ |
| Screenshot | ✅ PowerShell | ✅ screencapture | ✅ scrot |
| Keyboard | ✅ SendKeys | ✅ osascript | ✅ xdotool |
| Mouse | ✅ user32.dll | ⚠️ Limited | ✅ xdotool |
| Windows | ✅ user32.dll | ✅ osascript | ✅ wmctrl |
| Clipboard | ✅ PowerShell | ✅ pbcopy/paste | ✅ xclip |

## Configuration

Optional config file at `~/.mcp/config.json`:

```json
{
  "storage": {
    "type": "sqlite",
    "path": "~/.mcp/workspace.db"
  },
  "cliPolicy": {
    "mode": "allow-all",
    "extraBlockedPatterns": [],
    "timeoutMs": 30000
  },
  "crud": {
    "defaultLimit": 1000
  },
  "fileReading": {
    "maxLines": 500,
    "warnAtLines": 100
  },
  "batchOperations": {
    "maxOperations": 50,
    "maxAggregateChars": 200000,
    "maxLinesPerFile": 500,
    "defaultTimeout": 30000,
    "toolLimits": {
      "exec_cli": { "maxOperations": 20, "timeout": 60000 }
    }
  }
}
```

## Development

```bash
npm install      # Install dependencies
npm run build    # Build TypeScript
npm run dev      # Watch mode
npm test         # Run tests
npm start        # Run server
```

## Known Limitations

- `find_on_screen` requires additional OCR dependencies (not included)
- macOS mouse position reading returns 0,0 (system limitation)
- Some mouse drag operations may require platform-specific tuning

## License

MIT License - see [LICENSE](LICENSE) file.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.
