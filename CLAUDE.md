# mnehmos.ooda.mcp - Agent Instructions

## Quick Reference

| Property | Value |
|----------|-------|
| **Type** | MCP Server |
| **Tools** | 100 |
| **Version** | 1.0.0 |
| **Entry** | `src/index.ts` |
| **Language** | TypeScript (ESM) |
| **Database** | SQLite (audit logs, CRUD storage) |

---

## Architecture

```
src/
├── index.ts           # Server entry, tool registration (900+ lines)
├── config.ts          # Configuration loading from ~/.mcp/config.json
├── audit.ts           # Audit trail logging to SQLite
├── constants.ts       # Centralized timeout/limit constants
├── storage/
│   └── db.ts          # SQLite database initialization
├── utils/
│   └── powerShellSession.ts  # Persistent PowerShell for Windows
└── tools/
    ├── cli.ts         # Shell commands, file read/write
    ├── crud.ts        # SQLite key-value CRUD operations
    ├── screen.ts      # Screenshots, display info
    ├── input.ts       # Keyboard/mouse simulation
    ├── window.ts      # Window management, app launching
    ├── clipboard.ts   # Clipboard operations
    ├── system.ts      # Process, environment, network
    ├── filesystem.ts  # File copy/move/delete/search
    ├── sessions.ts    # Interactive process sessions
    ├── analytics.ts   # Usage stats, audit log queries
    ├── configTools.ts # Runtime config get/set
    ├── executeCode.ts # In-memory code execution
    ├── paginatedSearch.ts # Paginated file search
    ├── batchDispatcher.ts # Generic batch_tools handler
    ├── batchTools.ts  # Batch operation wrappers
    ├── diff/          # Intelligent file editing
    │   ├── editBlock.ts
    │   ├── applyDiff.ts
    │   ├── batchEditBlocks.ts
    │   ├── writeFromLine.ts
    │   ├── getDiffPreview.ts
    │   ├── fuzzySearch.ts
    │   ├── diffVisualizer.ts
    │   ├── lineEndings.ts
    │   └── schemas.ts
    └── browser/       # Browser automation
        ├── tools.ts
        ├── browserManager.ts
        ├── interfaces.ts
        └── providers/
            ├── puppeteerProvider.ts
            └── playwrightProvider.ts
```

---

## Development Commands

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Watch mode compilation
npm test         # Run all tests (Node.js built-in runner)
npm start        # Start MCP server on stdio
```

---

## Key Patterns

### 1. Schema-First Validation

All tools define Zod schemas with `.describe()` for MCP protocol:

```typescript
export const MyToolSchema = {
    path: z.string().describe('Absolute file path'),
    timeout: z.number().optional().describe('Timeout in ms'),
};
```

### 2. Audit Trail

Every tool operation logs to SQLite via `logAudit()`:

```typescript
await logAudit('tool_name', args, result, error);
```

### 3. Platform Abstraction

Cross-platform code checks `os.platform()`:
- **Windows**: PowerShell + Win32 API via P/Invoke
- **macOS**: osascript + screencapture
- **Linux**: xdotool + wmctrl + scrot

### 4. Batch Operations

Single-item tools should have batch counterparts following the pattern:
```typescript
export async function handleBatch*(args: { operations: Array<...> }) {
    const results = await Promise.all(operations.map(op => handle*(op)));
    return { summary: { total, successful, failed }, results };
}
```

### 5. Tool Registration

Tools are registered in `src/index.ts`:
1. Import handler and schema from tool file
2. Add to `ListToolsRequestSchema` handler array
3. Add case to `CallToolRequestSchema` switch statement

---

## Testing

Tests use Node.js built-in test runner with tsx:

```bash
# Run all tests
npm test

# Run specific test file
node --import tsx --test src/tools/diff/batchEditBlocks.test.ts
```

Test files are colocated with source: `*.test.ts`

---

## Configuration

User config: `~/.mcp/config.json`

Key settings:
- `storage.dataDir`: Database location (default: `~/.mcp`)
- `cliPolicy.timeoutMs`: CLI command timeout (default: 120000)
- `batchOperations.maxOperations`: Batch limit (default: 50)

See `src/config.ts` for full defaults.

---

## Adding New Tools

1. Create handler function and Zod schema in `src/tools/{category}.ts`
2. Export both from the file
3. Import in `src/index.ts`
4. Add to `ListToolsRequestSchema` handler (tools array)
5. Add case to `CallToolRequestSchema` handler (switch statement)
6. Add test in `src/tools/{category}.test.ts`
7. Update README.md tool count
8. Run `npm run build && npm test`

---

## Critical Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | ~920 | All tool registration, main entry |
| `src/tools/cli.ts` | ~570 | Core file I/O operations |
| `src/tools/window.ts` | ~940 | Windows management (largest tool file) |
| `src/tools/diff/*.ts` | ~1500 | Intelligent file editing suite |
| `src/config.ts` | ~200 | Configuration system |

---

## Security Notes

This server provides **unrestricted system access** (YOLO mode):
- Shell command execution
- File read/write anywhere
- Process management
- Input simulation (keyboard/mouse)

Use only in trusted environments. See README.md security section.

---

## Debugging Tips

1. **MCP stdio protocol**: stderr for logs, stdout for JSON-RPC
2. **Audit log queries**: Use `get_recent_tool_calls` tool
3. **PowerShell issues**: Check `powerShellSession.ts` stderr handling
4. **Browser automation**: Uses Puppeteer by default, falls back to Playwright
