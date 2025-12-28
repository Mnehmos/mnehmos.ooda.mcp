# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
