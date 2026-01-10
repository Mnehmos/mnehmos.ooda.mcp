# ADR-003: Generic Batch Tools Dispatcher

## Status
**Accepted** | 2025-01-10

## Context

The OODA MCP server has grown to 100 tools across multiple categories. Many tools have dedicated batch variants (e.g., `batch_read_files`, `batch_exec_cli`, `crud_batch_create`), but this creates:

| Problem | Impact |
|---------|--------|
| Tool proliferation | 15+ batch variants with similar patterns |
| Inconsistent limits | Each batch tool implements own safety checks |
| Missing coverage | Some tools lack batch variants entirely |
| Maintenance burden | Bug fixes must be applied to many places |

### Requirements

1. **Universal batching** - Batch ANY tool with a single dispatcher
2. **Unified safety limits** - Central configuration for all batch operations
3. **Execution modes** - Support both parallel and sequential execution
4. **Backward compatibility** - Existing batch tools continue to work

## Decision

Implement a generic `batch_tools` dispatcher that can execute any registered tool in batch mode with configurable safety limits.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      batch_tools                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  SafetyEnforcer                                      │    │
│  │  - validateBatchSize()                               │    │
│  │  - enforcePerOperationLimit()                        │    │
│  │  - checkAggregateSize()                              │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  TOOL_REGISTRY (Map<string, handler>)                │    │
│  │  - exec_cli, read_file, write_file, ...              │    │
│  │  - crud_create, crud_read, ...                       │    │
│  │  - screenshot, keyboard_type, ...                    │    │
│  │  - 50+ registered tools                              │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│              ┌─────────────┴─────────────┐                  │
│              ▼                           ▼                  │
│     [Parallel Mode]              [Sequential Mode]          │
│     Promise.all()                for...of loop              │
│                                  + stopOnError              │
└─────────────────────────────────────────────────────────────┘
```

### Schema

```typescript
const BatchToolsSchema = {
    operations: z.array(z.object({
        tool: z.string(),      // Tool name (e.g., "read_file")
        args: z.record(z.any()), // Tool-specific arguments
        label: z.string().optional() // For tracking in results
    })),
    executionMode: z.enum(['parallel', 'sequential']).optional(),
    stopOnError: z.boolean().optional(),
    timeout: z.number().optional(),
    safetyLimits: z.object({
        maxOperations: z.number().optional(),
        maxAggregateChars: z.number().optional(),
        maxLinesPerFile: z.number().optional()
    }).optional()
};
```

### Configuration

Safety limits are configurable via `~/.mcp/config.json`:

```json
{
  "batchOperations": {
    "maxOperations": 50,
    "maxAggregateChars": 200000,
    "maxLinesPerFile": 500,
    "defaultTimeout": 30000,
    "defaultExecutionMode": "parallel",
    "toolLimits": {
      "exec_cli": {
        "maxOperations": 20,
        "timeout": 60000
      }
    }
  }
}
```

### Safety Enforcement

The `SafetyEnforcer` class provides three layers of protection:

1. **Pre-execution validation**
   - Reject batches exceeding `maxOperations`
   - Validate tool names exist in registry

2. **Per-operation limits**
   - Truncate file reads at `maxLinesPerFile`
   - Apply tool-specific timeouts

3. **Post-execution checks**
   - Warn if aggregate output exceeds `maxAggregateChars`
   - Report truncation in results

### Result Format

```json
{
  "summary": {
    "total": 5,
    "successful": 4,
    "failed": 1,
    "elapsed_ms": 234,
    "executionMode": "parallel",
    "warnings": []
  },
  "results": [
    { "index": 0, "tool": "read_file", "success": true, "result": {...} },
    { "index": 1, "tool": "exec_cli", "success": false, "error": "Command timed out" }
  ]
}
```

## Usage Examples

### Example 1: Read Multiple Files

```json
{
  "tool": "batch_tools",
  "args": {
    "operations": [
      { "tool": "read_file", "args": { "path": "src/index.ts" } },
      { "tool": "read_file", "args": { "path": "src/config.ts" } },
      { "tool": "read_file", "args": { "path": "package.json" } }
    ]
  }
}
```

### Example 2: Mixed Operations

```json
{
  "tool": "batch_tools",
  "args": {
    "operations": [
      { "tool": "file_info", "args": { "path": "src/" }, "label": "src-info" },
      { "tool": "list_directory", "args": { "path": "src/tools" }, "label": "tools-list" },
      { "tool": "exec_cli", "args": { "command": "git status --short" }, "label": "git-status" }
    ],
    "executionMode": "parallel"
  }
}
```

### Example 3: Sequential with Stop on Error

```json
{
  "tool": "batch_tools",
  "args": {
    "operations": [
      { "tool": "write_file", "args": { "path": "step1.txt", "content": "Step 1" } },
      { "tool": "write_file", "args": { "path": "step2.txt", "content": "Step 2" } },
      { "tool": "exec_cli", "args": { "command": "cat step1.txt step2.txt > combined.txt" } }
    ],
    "executionMode": "sequential",
    "stopOnError": true
  }
}
```

### Example 4: Custom Safety Limits

```json
{
  "tool": "batch_tools",
  "args": {
    "operations": [...],
    "safetyLimits": {
      "maxOperations": 100,
      "maxLinesPerFile": 1000
    }
  }
}
```

## Consequences

### Positive

1. **Single entry point** for all batch operations
2. **Consistent safety** across all tools
3. **Reduced maintenance** - fixes apply universally
4. **Flexible execution** - parallel or sequential modes
5. **Future-proof** - new tools automatically batchable

### Negative

1. **Registry maintenance** - new tools must be registered
2. **Slight overhead** - dispatch lookup vs direct call
3. **Recursion risk** - batch tools excluded from registry

### Mitigations

- Clear error messages for unknown tools
- Explicit exclusion of batch tools from registry
- Performance impact negligible (<1ms per dispatch)

## Implementation

### File Locations

```
src/
├── config.ts              # batchOperations config + getBatchSafetyLimits()
├── tools/
│   ├── batchDispatcher.ts # Core dispatcher logic + SafetyEnforcer
│   ├── batchTools.ts      # Schema + re-export handler
│   └── ...
└── index.ts               # Tool registration
```

### Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `getBatchSafetyLimits()` | config.ts | Get limits with tool overrides |
| `SafetyEnforcer` | batchDispatcher.ts | Validation and enforcement |
| `dispatchToolCall()` | batchDispatcher.ts | Single tool dispatch with timeout |
| `handleBatchTools()` | batchDispatcher.ts | Main handler |

## Known Technical Debt

### Duplicate BatchResult Interface

The `BatchResult` interface is defined in three files:
- `src/tools/cli.ts:557`
- `src/tools/crud.ts:230`
- `src/tools/filesystem.ts:62`

**Recommendation**: Extract to `src/types/batch.ts` in future release.

### Inline Schema Definitions

100 schema definitions are inline across tool files.

**Recommendation**: Consider `src/schemas/` directory for centralization in future release.

## References

- [ADR-002: Batch Editing Tools](ADR-002-batch-editing-tools.md)
- [Config Documentation](../README.md#configuration)
- Implementation: [`src/tools/batchDispatcher.ts`](../src/tools/batchDispatcher.ts)
