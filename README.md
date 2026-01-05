# mnehmos.ooda.mcp (v2.0.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive MCP (Model Context Protocol) server that provides full computer control capabilities to Claude. Implements the OODA loop (Observe-Orient-Decide-Act) pattern for autonomous computer interaction.

## Features

| Category | Tools | Description |
|----------|-------|-------------|
| **CLI & Files** | 17 | Shell commands, file read/write/copy/move/delete, search |
| **CRUD Database** | 9 | Persistent SQLite key-value store with collections |
| **Screen (Observe)** | 4 | Screenshot, display info, screen change detection |
| **Input (Act)** | 10 | Keyboard typing/shortcuts, mouse move/click/drag/scroll |
| **Window Management** | 10 | List/focus/minimize/maximize/close windows, launch apps |
| **Clipboard** | 4 | Read/write text, HTML, images |
| **System** | 8 | System info, processes, network, notifications |

**Total: 62 tools** with batch/parallel execution support for most operations.

## Security Warning

This server provides **unrestricted system access**. Claude will be able to:
- Execute arbitrary shell commands
- Control keyboard and mouse
- Take screenshots
- Read/write files anywhere
- Manage windows and processes

**Use at your own risk in trusted environments only.**

## Installation

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

```json
{
  "mcpServers": {
    "ooda-computer": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ooda-computer/dist/index.js"]
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

## API Reference

### CLI & File Operations

| Tool | Description |
|------|-------------|
| `exec_cli` | Execute shell command |
| `read_file` | Read file contents |
| `write_file` | Write content to file |
| `list_directory` | List directory contents |
| `copy_file` | Copy file/directory |
| `move_file` | Move/rename file |
| `delete_file` | Delete file/directory |
| `file_info` | Get file metadata |
| `search_files` | Search files by pattern |
| `batch_*` | Parallel versions of above |

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

## Batch Operations

Most tools have batch versions for parallel execution:

```
batch_exec_cli      - Multiple commands in parallel
batch_read_files    - Multiple files in parallel
batch_write_files   - Multiple files in parallel
batch_copy_files    - Multiple copies in parallel
crud_batch_create   - Multiple records in parallel
...
```

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

## Development

```bash
npm install      # Install dependencies
npm run build    # Build TypeScript
npm run dev      # Watch mode
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
