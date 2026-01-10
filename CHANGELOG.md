# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-01-10 (Production Release)

### Summary
First production release for npm publication. Consolidates all features from development versions (1.x, 2.x, 3.x).

### Features (100 tools across 12 categories)
- **CLI & Files**: 18 tools for shell commands and file operations
- **Diff Editing**: 6 tools for intelligent search/replace with fuzzy matching
- **CRUD Database**: 9 tools for SQLite key-value storage
- **Screen**: 4 tools for screenshots, display info, change detection
- **Input**: 10 tools for keyboard and mouse automation
- **Window**: 11 tools for window management and application launching
- **Clipboard**: 4 tools for clipboard operations
- **System**: 8 tools for process, environment, and network info
- **Browser**: 9 tools for Puppeteer/Playwright automation
- **Sessions**: 5 tools for interactive process management
- **Config/Analytics**: 7 tools for configuration and usage stats
- **Generic Batch**: Universal `batch_tools` dispatcher for any tool

### Changed
- Version reset to 1.0.0 for production npm release
- Server name aligned to `mnehmos.ooda.mcp`

---

## [3.0.0] - 2025-01-10 (Development)

### Added

#### Generic Batch Dispatcher
- `batch_tools` - Universal batch dispatcher that can execute ANY tool in batch mode. See [ADR-003](docs/ADR-003-generic-batch-tools.md).
  - Supports parallel and sequential execution modes
  - Unified safety limits (maxOperations, maxAggregateChars, maxLinesPerFile)
  - Configurable per-tool overrides via `~/.mcp/config.json`
  - Labels for tracking operations in results

#### Diff-Based Editing Tools
- `batch_edit_blocks` - Apply multiple search/replace operations to a single file sequentially with partial success support. See [ADR-002](docs/ADR-002-batch-editing-tools.md).
- `write_from_line` - Replace content starting from a specific line number, ideal for bulk section replacement in large files. See [ADR-002](docs/ADR-002-batch-editing-tools.md).

#### Configuration Enhancements
- `batchOperations` config section with safety limits
- `getBatchSafetyLimits()` helper for per-tool limit overrides
- Tool-specific timeout and operation limits

### Changed
- Tool count increased from 62 to 100
- Improved batch operation safety with aggregate size warnings
- Updated documentation with batch_tools examples

### Fixed
- Replaced console.log with console.error in PowerShell session handler

### Security
- Batch operations now enforce configurable safety limits
- Aggregate output size warnings prevent context overflow

## [2.0.0] - 2025-12-01

### Added

#### OODA Loop Computer Control
- **Screen Perception**: `screenshot`, `get_screen_info`, `wait_for_screen_change`, `find_on_screen`
- **Input Simulation**: `keyboard_type`, `keyboard_press`, `keyboard_shortcut`, `mouse_move`, `mouse_click`, `mouse_drag`, `mouse_scroll`, `get_mouse_position`
- **Window Management**: `list_windows`, `get_active_window`, `focus_window`, `minimize_window`, `maximize_window`, `restore_window`, `close_window`, `resize_window`, `move_window`, `launch_application`
- **Clipboard**: `clipboard_read`, `clipboard_write`, `clipboard_clear`, `clipboard_has_format`
- **System Operations**: `get_system_info`, `list_processes`, `kill_process`, `get_environment`, `set_environment`, `get_network_info`, `wait`, `notify`

#### Enhanced Filesystem Operations
- `copy_file` / `batch_copy_files` - Copy files and directories
- `move_file` / `batch_move_files` - Move/rename files
- `delete_file` / `batch_delete_files` - Delete files and directories
- `file_info` / `batch_file_info` - Get file metadata
- `search_files` - Search files by pattern in directory tree

#### Batch/Parallel Execution
- All major operations now have batch versions for parallel execution
- `batch_exec_cli` - Multiple shell commands in parallel
- `batch_read_files` / `batch_write_files` - Multiple file operations in parallel
- `batch_keyboard_actions` / `batch_mouse_actions` - Sequences of input actions
- `crud_batch_create` / `crud_batch_read` / `crud_batch_update` / `crud_batch_delete` - Multiple database operations in parallel

#### Cross-Platform Support
- Windows: PowerShell + Win32 API via P/Invoke
- macOS: osascript + screencapture
- Linux: xdotool + wmctrl + scrot

### Changed
- Renamed project from `mcp-crud-cli` to `mcp-ooda-computer`
- Updated version to 2.0.0
- Improved tool descriptions to guide parallel usage
- All batch operations now return structured results with timing info

### Fixed
- macOS window listing now properly parses osascript output
- Batch scroll action now actually performs scrolling
- Naming convention fix: `getmacKeyCode` -> `getMacKeyCode`

## [1.1.0] - 2025-12-01

### Added
- Batch operation support for all CLI tools
- Batch operation support for all CRUD tools
- Parallel execution using Promise.all()
- Structured batch results with success/failure per item

### Changed
- Tool descriptions now guide users toward batch alternatives
- Batch operations return elapsed time in milliseconds

## [1.0.0] - 2025-12-01

### Added
- Initial release
- CLI tools for executing shell commands
- File operations (read, write, list directory)
- CRUD operations backed by SQLite
- Global workspace database
- Audit logging for all operations
- Configuration support via `~/.mcp/config.json`
- TypeScript support
- Comprehensive documentation

### Security
- Warning: This server provides unrestricted CLI access (YOLO mode)
