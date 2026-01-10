# Task Map: Batch Editing Tools Implementation

## Overview
Implement `batch_edit_blocks` and `write_from_line` tools per ADR-002.

**Related ADR:** [ADR-002-batch-editing-tools.md](./ADR-002-batch-editing-tools.md)  
**Priority:** High  
**Estimated Effort:** 2-3 hours

---

## Tasks

### Task 1: Create `batchEditBlocks.ts` Handler
**task_id:** `BATCH-001`  
**mode:** `code`  
**workspace_path:** `src/tools/diff/`  
**file_patterns:** `batchEditBlocks.ts`  

**Acceptance Criteria:**
- [ ] File exports `handleBatchEditBlocks` function
- [ ] File exports `BatchEditBlocksResult` interface
- [ ] Reads file once at start, applies edits sequentially to in-memory content
- [ ] Each edit operates on result of previous edit (cascading)
- [ ] Tracks success/failure per edit with index and optional label
- [ ] Writes file once at end (only if any edits succeeded and not dryRun)
- [ ] `stopOnError: true` halts on first failure but still saves completed work
- [ ] Returns cumulative diff from original → final content
- [ ] Reuses existing fuzzy matching from `fuzzySearch.ts`
- [ ] Reuses diff visualization from `diffVisualizer.ts`
- [ ] Logs via `logAudit()`

**Implementation Notes:**
```typescript
// Core algorithm:
// 1. content = readFile(path)
// 2. originalContent = content
// 3. for each edit:
//    - result = performSingleEdit(content, edit, fuzzyThreshold)
//    - track result
//    - if success: content = result.newContent
//    - if fail && stopOnError: break
// 4. if successCount > 0 && !dryRun: writeFile(path, content)
// 5. return { results, finalDiff: diff(original, content) }
```

**Dependencies:** None

---

### Task 2: Create `writeFromLine.ts` Handler
**task_id:** `BATCH-002`  
**mode:** `code`  
**workspace_path:** `src/tools/diff/`  
**file_patterns:** `writeFromLine.ts`  

**Acceptance Criteria:**
- [ ] File exports `handleWriteFromLine` function
- [ ] File exports `WriteFromLineResult` interface
- [ ] Accepts `startLine` (1-indexed, inclusive)
- [ ] Accepts optional `endLine` (1-indexed, inclusive) - if omitted, replaces to EOF
- [ ] Keeps lines 1 to (startLine-1) unchanged
- [ ] Keeps lines (endLine+1) to EOF unchanged (if endLine specified)
- [ ] Inserts new content in place of replaced lines
- [ ] Returns count of lines replaced and new line count
- [ ] Generates unified diff preview
- [ ] Supports `dryRun` mode
- [ ] Logs via `logAudit()`

**Implementation Notes:**
```typescript
// Core algorithm:
// 1. lines = readFile(path).split('\n')
// 2. keepBefore = lines.slice(0, startLine - 1)
// 3. keepAfter = endLine ? lines.slice(endLine) : []
// 4. newLines = content.split('\n')
// 5. finalContent = [...keepBefore, ...newLines, ...keepAfter].join('\n')
// 6. if !dryRun: writeFile(path, finalContent)
```

**Dependencies:** None

---

### Task 3: Update `src/tools/diff/index.ts` Exports
**task_id:** `BATCH-003`  
**mode:** `code`  
**workspace_path:** `src/tools/diff/`  
**file_patterns:** `index.ts`  

**Acceptance Criteria:**
- [ ] Export `WriteFromLineSchema` from schemas
- [ ] Export `handleBatchEditBlocks` from batchEditBlocks.ts
- [ ] Export `handleWriteFromLine` from writeFromLine.ts
- [ ] Export type aliases for args and results

**Dependencies:** `BATCH-001`, `BATCH-002`

---

### Task 4: Register Tools in Main `src/index.ts`
**task_id:** `BATCH-004`  
**mode:** `code`  
**workspace_path:** `src/`  
**file_patterns:** `index.ts`  

**Acceptance Criteria:**
- [ ] Import new handlers and schemas from `./tools/diff/index.js`
- [ ] Add `batch_edit_blocks` tool definition in ListToolsRequestSchema handler
- [ ] Add `write_from_line` tool definition in ListToolsRequestSchema handler
- [ ] Add case handlers in CallToolRequestSchema switch statement
- [ ] Tool descriptions match ADR specifications

**Tool Definitions:**
```typescript
{
  name: 'batch_edit_blocks',
  description: 'Apply multiple search/replace operations to a single file sequentially. Unlike apply_diff, this allows partial success - completed edits are saved even if later edits fail. Use for bulk formatting tasks on large files.',
  inputSchema: toJsonSchema(BatchEditBlocksSchema, ['path', 'edits']),
}

{
  name: 'write_from_line',
  description: 'Replace content starting from a specific line number. Use startLine to keep lines 1-(startLine-1) and replace from startLine to EOF (or to endLine if specified). Ideal for bulk section replacement in large files.',
  inputSchema: toJsonSchema(WriteFromLineSchema, ['path', 'startLine', 'content']),
}
```

**Dependencies:** `BATCH-003`

---

### Task 5: Add Tests
**task_id:** `BATCH-005`  
**mode:** `code`  
**workspace_path:** `src/tools/diff/`  
**file_patterns:** `*.test.ts`  

**Acceptance Criteria:**
- [ ] Test `batch_edit_blocks` with multiple successful edits
- [ ] Test `batch_edit_blocks` with partial failure (some edits fail)
- [ ] Test `batch_edit_blocks` with `stopOnError: true`
- [ ] Test `batch_edit_blocks` with `dryRun: true`
- [ ] Test `write_from_line` replacing to EOF
- [ ] Test `write_from_line` replacing specific range
- [ ] Test `write_from_line` with `dryRun: true`
- [ ] Test edge cases: first line, last line, empty content

**Dependencies:** `BATCH-001`, `BATCH-002`

---

### Task 6: Update CHANGELOG.md
**task_id:** `BATCH-006`  
**mode:** `code`  
**workspace_path:** `.`  
**file_patterns:** `CHANGELOG.md`  

**Acceptance Criteria:**
- [ ] Add entry for new `batch_edit_blocks` tool
- [ ] Add entry for new `write_from_line` tool
- [ ] Reference ADR-002

**Dependencies:** `BATCH-004`

---

## Execution Order

```
BATCH-001 ─┬─► BATCH-003 ─► BATCH-004 ─► BATCH-006
BATCH-002 ─┘              │
                          └─► BATCH-005
```

Tasks 1 and 2 can run in parallel.  
Task 3 depends on both 1 and 2.  
Task 4 depends on 3.  
Tasks 5 and 6 depend on 4.

---

## Contracts Summary

### `batch_edit_blocks` Input
```typescript
{
  path: string;                    // Required
  edits: Array<{                   // Required
    search: string;
    replace: string;
    label?: string;
    expectedReplacements?: number; // Default: 1
  }>;
  stopOnError?: boolean;           // Default: false
  dryRun?: boolean;                // Default: false
  fuzzyThreshold?: number;         // Default: 0.7
}
```

### `batch_edit_blocks` Output
```typescript
{
  success: boolean;                // All edits succeeded
  totalEdits: number;
  successfulEdits: number;
  failedEdits: number;
  results: Array<{
    index: number;
    label?: string;
    success: boolean;
    message: string;
    diff?: string;
  }>;
  finalDiff?: string;              // Original → Final cumulative diff
}
```

### `write_from_line` Input
```typescript
{
  path: string;                    // Required
  startLine: number;               // Required, 1-indexed
  endLine?: number;                // Optional, 1-indexed
  content: string;                 // Required
  dryRun?: boolean;                // Default: false
}
```

### `write_from_line` Output
```typescript
{
  success: boolean;
  message: string;
  linesReplaced: number;
  newLineCount: number;
  diff?: string;                   // Unified diff preview
}
```
