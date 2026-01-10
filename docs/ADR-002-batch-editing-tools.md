# ADR-002: Batch Editing Tools for Large Files

## Status
**Proposed** | 2025-12-31

## Context

When working with very large markdown files (6,000-10,000+ lines), such as transcribing PDF content like the D&D 5e SRD, the current editing tools are insufficient:

| Tool | Limitation |
|------|-----------|
| `edit_block` | Single operation per call - requires hundreds of tool calls |
| `apply_diff` | All-or-nothing validation - one failure blocks all changes |
| `batch_str_replace` | Multi-file oriented, not optimized for same-file sequential edits |
| `write_file` | Requires sending entire file content every time |

### Problem Statement

A typical spell formatting task requires:
- Reading raw PDF text (inconsistent formatting)
- Applying ~400 search/replace operations per file
- Each operation transforms one section (e.g., one spell definition)
- Current approach: 400 separate tool calls, each with latency overhead

### Requirements

1. **Sequential batch edits** - Apply N edits to same file in one call
2. **Partial success** - Don't lose completed work when one edit fails  
3. **Bulk line replacement** - Replace everything from line N forward
4. **Progress visibility** - Know which edits succeeded/failed

## Decision

Implement two new tools:

### 1. `batch_edit_blocks` - Sequential Multi-Edit

Apply multiple `edit_block` operations to a single file sequentially, with per-edit success/failure tracking.

```typescript
interface BatchEditBlocksArgs {
  path: string;                    // Single file path
  edits: Array<{
    search: string;
    replace: string;
    label?: string;                // Optional identifier for progress tracking
    expectedReplacements?: number; // Default: 1
  }>;
  stopOnError?: boolean;           // Default: false (continue on failure)
  dryRun?: boolean;                // Default: false
  fuzzyThreshold?: number;         // Default: 0.7
}

interface BatchEditBlocksResult {
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
  finalDiff?: string;              // Cumulative diff from original
}
```

**Key behaviors:**
- Reads file once at start
- Applies edits sequentially to in-memory content
- Each edit operates on the result of the previous edit
- Tracks success/failure per edit
- Writes file once at end (if any edits succeeded and not dryRun)
- `stopOnError: true` halts on first failure, still saves completed work

### 2. `write_from_line` - Bulk Line Replacement

Replace content starting from a specific line number. Designed for "take the first N lines, then replace everything after with new content" workflows.

```typescript
interface WriteFromLineArgs {
  path: string;
  startLine: number;               // 1-indexed, inclusive
  endLine?: number;                // Optional: if omitted, replaces to EOF
  content: string;                 // New content to insert
  dryRun?: boolean;                // Default: false
}

interface WriteFromLineResult {
  success: boolean;
  message: string;
  linesReplaced: number;           // How many original lines were replaced
  newLineCount: number;            // How many lines in the new content
  diff?: string;                   // Unified diff preview
}
```

**Key behaviors:**
- `startLine: 2070` keeps lines 1-2069, replaces from 2070 onward
- `startLine: 2070, endLine: 3000` keeps 1-2069 and 3001+, replaces 2070-3000
- Efficient for "I formatted lines 1-2069, now replace the rest"
- No fuzzy matching needed - purely line-based

## Architecture

### File Locations

```
src/tools/diff/
├── schemas.ts           # Add WriteFromLineSchema
├── batchEditBlocks.ts   # NEW: batch_edit_blocks handler
├── writeFromLine.ts     # NEW: write_from_line handler
└── index.ts             # Export new handlers and schemas
```

### Integration Points

1. **schemas.ts** - Already has `BatchEditBlocksSchema`, needs `WriteFromLineSchema`
2. **index.ts (diff)** - Export new handlers
3. **index.ts (root)** - Register tools, add to switch statement

### Implementation Strategy

#### `batch_edit_blocks`

```typescript
export async function handleBatchEditBlocks(args: BatchEditBlocksArgs) {
  const { path, edits, stopOnError = false, dryRun = false, fuzzyThreshold = 0.7 } = args;
  
  // 1. Read file once
  let content = fs.readFileSync(path, 'utf-8');
  const originalContent = content;
  const results: EditResult[] = [];
  
  // 2. Apply edits sequentially
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const result = performSingleEdit(content, edit, fuzzyThreshold);
    
    results.push({
      index: i,
      label: edit.label,
      ...result
    });
    
    if (result.success) {
      content = result.newContent;
    } else if (stopOnError) {
      break;
    }
  }
  
  // 3. Write if any succeeded and not dry run
  const successCount = results.filter(r => r.success).length;
  if (successCount > 0 && !dryRun) {
    fs.writeFileSync(path, content, 'utf-8');
  }
  
  // 4. Generate cumulative diff
  const finalDiff = generateDiff(originalContent, content, path);
  
  return {
    success: results.every(r => r.success),
    totalEdits: edits.length,
    successfulEdits: successCount,
    failedEdits: results.filter(r => !r.success).length,
    results,
    finalDiff
  };
}
```

#### `write_from_line`

```typescript
export async function handleWriteFromLine(args: WriteFromLineArgs) {
  const { path, startLine, endLine, content: newContent, dryRun = false } = args;
  
  // 1. Read and split into lines
  const originalContent = fs.readFileSync(path, 'utf-8');
  const lines = originalContent.split('\n');
  
  // 2. Calculate boundaries (1-indexed to 0-indexed)
  const keepBefore = lines.slice(0, startLine - 1);
  const keepAfter = endLine ? lines.slice(endLine) : [];
  const replacedCount = endLine 
    ? (endLine - startLine + 1) 
    : (lines.length - startLine + 1);
  
  // 3. Build new content
  const newLines = newContent.split('\n');
  const finalContent = [...keepBefore, ...newLines, ...keepAfter].join('\n');
  
  // 4. Generate diff preview
  const diff = generateDiff(originalContent, finalContent, path);
  
  // 5. Write if not dry run
  if (!dryRun) {
    fs.writeFileSync(path, finalContent, 'utf-8');
  }
  
  return {
    success: true,
    message: dryRun 
      ? `DRY RUN: Would replace lines ${startLine}-${endLine || 'EOF'}`
      : `Replaced lines ${startLine}-${endLine || 'EOF'}`,
    linesReplaced: replacedCount,
    newLineCount: newLines.length,
    diff
  };
}
```

## Usage Examples

### Example 1: Format Multiple Spells

```json
{
  "tool": "batch_edit_blocks",
  "args": {
    "path": "Resources/markdown/SRD 5.2/07-Spells.md",
    "edits": [
      {
        "label": "Detect Evil and Good",
        "search": "Detect Evil and Good\nLevel 1 Divination...",
        "replace": "### Detect Evil and Good\n\n**Level 1 Divination**..."
      },
      {
        "label": "Detect Magic",
        "search": "Detect Magic\nLevel 1 Divination...",
        "replace": "### Detect Magic\n\n**Level 1 Divination**..."
      }
      // ... 50 more spells
    ],
    "stopOnError": false
  }
}
```

### Example 2: Replace Unformatted Section

```json
{
  "tool": "write_from_line",
  "args": {
    "path": "Resources/markdown/SRD 5.2/07-Spells.md",
    "startLine": 2070,
    "content": "### Find Traps\n\n**Level 2 Divination** (Cleric, Druid, Ranger)\n\n...[formatted content]..."
  }
}
```

### Example 3: Insert Formatted Section

```json
{
  "tool": "write_from_line", 
  "args": {
    "path": "Resources/markdown/SRD 5.2/07-Spells.md",
    "startLine": 2070,
    "endLine": 3500,
    "content": "[formatted content for lines 2070-3500 only]"
  }
}
```

## Consequences

### Positive

1. **10-50x fewer tool calls** for large file transformations
2. **Partial success preservation** - completed work isn't lost on failure
3. **Clear progress tracking** - know exactly which edits succeeded/failed
4. **Efficient bulk operations** - read once, apply many, write once
5. **Line-based replacement** - simple mental model for "replace from here"

### Negative

1. **Larger request payloads** - sending 50 edits in one call
2. **Memory usage** - entire file in memory during batch operations
3. **Complexity** - more sophisticated error handling needed

### Mitigations

- Implement streaming/chunked response for large result sets
- Add `maxEditsPerCall` config option if needed
- Document recommended batch sizes (50-100 edits per call)

## Implementation Checklist

- [ ] Create `src/tools/diff/batchEditBlocks.ts`
- [ ] Create `src/tools/diff/writeFromLine.ts`  
- [ ] Update `src/tools/diff/schemas.ts` with `WriteFromLineSchema`
- [ ] Update `src/tools/diff/index.ts` exports
- [ ] Register both tools in `src/index.ts`
- [ ] Add tests for both tools
- [ ] Update CHANGELOG.md

## References

- Existing implementation: [`src/tools/diff/editBlock.ts`](../src/tools/diff/editBlock.ts)
- Schema definitions: [`src/tools/diff/schemas.ts`](../src/tools/diff/schemas.ts)
- Related ADR: ADR-001 (if exists)
