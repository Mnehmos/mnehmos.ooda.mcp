// Diff visualization utilities
// Generates unified diffs, inline character diffs, and side-by-side comparisons

export interface DiffHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: DiffLine[];
}

export interface DiffLine {
    type: 'context' | 'add' | 'remove';
    content: string;
    oldLineNum?: number;
    newLineNum?: number;
}

export interface DiffResult {
    hunks: DiffHunk[];
    unified: string;
    inline: string;
    stats: {
        additions: number;
        deletions: number;
        changes: number;
    };
}

/**
 * Generate a unified diff between two strings
 * @param original - The original content
 * @param modified - The modified content
 * @param filepath - File path for the diff header
 * @param contextLines - Number of context lines around changes (default: 3)
 * @returns DiffResult with multiple diff formats
 */
export function generateDiff(
    original: string,
    modified: string,
    filepath: string,
    contextLines: number = 3
): DiffResult {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    
    // Compute the LCS-based diff
    const diffLines = computeDiff(originalLines, modifiedLines);
    
    // Group into hunks with context
    const hunks = groupIntoHunks(diffLines, originalLines, modifiedLines, contextLines);
    
    // Generate unified format
    const unified = formatUnifiedDiff(hunks, filepath);
    
    // Generate inline format for the changed content
    const inline = formatInlineDiff(original, modified);
    
    // Calculate stats
    const stats = {
        additions: diffLines.filter(l => l.type === 'add').length,
        deletions: diffLines.filter(l => l.type === 'remove').length,
        changes: hunks.length
    };
    
    return { hunks, unified, inline, stats };
}

/**
 * Compute diff between two line arrays using a simple LCS approach
 */
function computeDiff(originalLines: string[], modifiedLines: string[]): DiffLine[] {
    const result: DiffLine[] = [];
    
    // Simple diff algorithm - find matching lines and mark differences
    let oldIdx = 0;
    let newIdx = 0;
    
    while (oldIdx < originalLines.length || newIdx < modifiedLines.length) {
        if (oldIdx >= originalLines.length) {
            // All remaining lines are additions
            result.push({
                type: 'add',
                content: modifiedLines[newIdx],
                newLineNum: newIdx + 1
            });
            newIdx++;
        } else if (newIdx >= modifiedLines.length) {
            // All remaining lines are deletions
            result.push({
                type: 'remove',
                content: originalLines[oldIdx],
                oldLineNum: oldIdx + 1
            });
            oldIdx++;
        } else if (originalLines[oldIdx] === modifiedLines[newIdx]) {
            // Lines match - context
            result.push({
                type: 'context',
                content: originalLines[oldIdx],
                oldLineNum: oldIdx + 1,
                newLineNum: newIdx + 1
            });
            oldIdx++;
            newIdx++;
        } else {
            // Lines differ - look ahead for potential resync
            const lookAhead = findResyncPoint(originalLines, modifiedLines, oldIdx, newIdx, 10);
            
            if (lookAhead) {
                // Delete lines until resync in original
                while (oldIdx < lookAhead.oldIdx) {
                    result.push({
                        type: 'remove',
                        content: originalLines[oldIdx],
                        oldLineNum: oldIdx + 1
                    });
                    oldIdx++;
                }
                // Add lines until resync in modified
                while (newIdx < lookAhead.newIdx) {
                    result.push({
                        type: 'add',
                        content: modifiedLines[newIdx],
                        newLineNum: newIdx + 1
                    });
                    newIdx++;
                }
            } else {
                // No resync found, treat as delete then add
                result.push({
                    type: 'remove',
                    content: originalLines[oldIdx],
                    oldLineNum: oldIdx + 1
                });
                result.push({
                    type: 'add',
                    content: modifiedLines[newIdx],
                    newLineNum: newIdx + 1
                });
                oldIdx++;
                newIdx++;
            }
        }
    }
    
    return result;
}

/**
 * Look ahead to find where the two sequences might resync
 */
function findResyncPoint(
    original: string[],
    modified: string[],
    oldStart: number,
    newStart: number,
    maxLookAhead: number
): { oldIdx: number; newIdx: number } | null {
    // Look for a matching line within the look-ahead window
    for (let i = 1; i <= maxLookAhead; i++) {
        for (let j = 0; j <= i; j++) {
            const oldIdx = oldStart + j;
            const newIdx = newStart + (i - j);
            
            if (oldIdx < original.length && newIdx < modified.length) {
                if (original[oldIdx] === modified[newIdx]) {
                    return { oldIdx, newIdx };
                }
            }
        }
    }
    return null;
}

/**
 * Group diff lines into hunks with surrounding context
 */
function groupIntoHunks(
    diffLines: DiffLine[],
    originalLines: string[],
    modifiedLines: string[],
    contextLines: number
): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let contextBuffer: DiffLine[] = [];
    
    for (let i = 0; i < diffLines.length; i++) {
        const line = diffLines[i];
        
        if (line.type === 'context') {
            if (currentHunk) {
                // We're in a hunk, add context
                currentHunk.lines.push(line);
                
                // Check if we should close the hunk (too much trailing context)
                const trailingContext = getTrailingContextCount(currentHunk.lines);
                if (trailingContext > contextLines) {
                    // Close hunk, keeping only contextLines of trailing context
                    currentHunk.lines = currentHunk.lines.slice(0, -(trailingContext - contextLines));
                    recalculateHunkCounts(currentHunk);
                    hunks.push(currentHunk);
                    currentHunk = null;
                    contextBuffer = diffLines.slice(i - contextLines + 1, i + 1)
                        .filter(l => l.type === 'context');
                }
            } else {
                // Buffer context for potential next hunk
                contextBuffer.push(line);
                if (contextBuffer.length > contextLines) {
                    contextBuffer.shift();
                }
            }
        } else {
            // This is a change line
            if (!currentHunk) {
                // Start new hunk with buffered context
                const startOld = contextBuffer.length > 0 
                    ? (contextBuffer[0].oldLineNum || 1)
                    : (line.oldLineNum || line.newLineNum || 1);
                const startNew = contextBuffer.length > 0
                    ? (contextBuffer[0].newLineNum || 1)
                    : (line.newLineNum || line.oldLineNum || 1);
                    
                currentHunk = {
                    oldStart: startOld,
                    oldCount: 0,
                    newStart: startNew,
                    newCount: 0,
                    lines: [...contextBuffer]
                };
                contextBuffer = [];
            }
            currentHunk.lines.push(line);
        }
    }
    
    // Don't forget the last hunk
    if (currentHunk && currentHunk.lines.some(l => l.type !== 'context')) {
        // Trim trailing context
        const trailingContext = getTrailingContextCount(currentHunk.lines);
        if (trailingContext > contextLines) {
            currentHunk.lines = currentHunk.lines.slice(0, -(trailingContext - contextLines));
        }
        recalculateHunkCounts(currentHunk);
        hunks.push(currentHunk);
    }
    
    return hunks;
}

function getTrailingContextCount(lines: DiffLine[]): number {
    let count = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].type === 'context') {
            count++;
        } else {
            break;
        }
    }
    return count;
}

function recalculateHunkCounts(hunk: DiffHunk): void {
    hunk.oldCount = hunk.lines.filter(l => l.type !== 'add').length;
    hunk.newCount = hunk.lines.filter(l => l.type !== 'remove').length;
}

/**
 * Format hunks as unified diff text
 */
function formatUnifiedDiff(hunks: DiffHunk[], filepath: string): string {
    if (hunks.length === 0) {
        return '(no changes)';
    }
    
    let output = `--- a/${filepath}\n+++ b/${filepath}\n`;
    
    for (const hunk of hunks) {
        output += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
        
        for (const line of hunk.lines) {
            switch (line.type) {
                case 'context':
                    output += ` ${line.content}\n`;
                    break;
                case 'add':
                    output += `+${line.content}\n`;
                    break;
                case 'remove':
                    output += `-${line.content}\n`;
                    break;
            }
        }
    }
    
    return output;
}

/**
 * Generate inline character-level diff showing changes with {-removed-}{+added+} markers
 * @param original - Original text
 * @param modified - Modified text
 * @returns Inline diff string
 */
export function formatInlineDiff(original: string, modified: string): string {
    // Find common prefix and suffix
    let prefixLength = 0;
    const minLength = Math.min(original.length, modified.length);
    
    while (prefixLength < minLength && original[prefixLength] === modified[prefixLength]) {
        prefixLength++;
    }
    
    let suffixLength = 0;
    while (
        suffixLength < minLength - prefixLength &&
        original[original.length - 1 - suffixLength] === modified[modified.length - 1 - suffixLength]
    ) {
        suffixLength++;
    }
    
    // Extract the different parts
    const commonPrefix = original.substring(0, prefixLength);
    const commonSuffix = original.substring(original.length - suffixLength);
    const removedPart = original.substring(prefixLength, original.length - suffixLength);
    const addedPart = modified.substring(prefixLength, modified.length - suffixLength);
    
    // Build inline diff
    let result = commonPrefix;
    if (removedPart) {
        result += `{-${removedPart}-}`;
    }
    if (addedPart) {
        result += `{+${addedPart}+}`;
    }
    result += commonSuffix;
    
    return result;
}

/**
 * Generate a side-by-side comparison
 * @param original - Original text
 * @param modified - Modified text
 * @param width - Width of each column (default: 40)
 * @returns Side-by-side comparison string
 */
export function formatSideBySide(original: string, modified: string, width: number = 40): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    
    const separator = ' | ';
    const header = `${'ORIGINAL'.padEnd(width)}${separator}${'MODIFIED'.padEnd(width)}`;
    const divider = '-'.repeat(width) + '-+-' + '-'.repeat(width);
    
    let output = header + '\n' + divider + '\n';
    
    for (let i = 0; i < maxLines; i++) {
        const origLine = (originalLines[i] || '').substring(0, width).padEnd(width);
        const modLine = (modifiedLines[i] || '').substring(0, width).padEnd(width);
        output += `${origLine}${separator}${modLine}\n`;
    }
    
    return output;
}

/**
 * Generate a summary of changes
 * @param result - DiffResult from generateDiff
 * @returns Human-readable summary
 */
export function summarizeDiff(result: DiffResult): string {
    const { stats } = result;
    const parts: string[] = [];
    
    if (stats.additions > 0) {
        parts.push(`+${stats.additions} line${stats.additions !== 1 ? 's' : ''}`);
    }
    if (stats.deletions > 0) {
        parts.push(`-${stats.deletions} line${stats.deletions !== 1 ? 's' : ''}`);
    }
    if (stats.changes > 0) {
        parts.push(`${stats.changes} hunk${stats.changes !== 1 ? 's' : ''}`);
    }
    
    return parts.join(', ') || 'no changes';
}
