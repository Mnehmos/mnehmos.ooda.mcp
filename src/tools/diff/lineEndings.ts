// Line ending detection and normalization utilities
// Handles cross-platform line ending differences (CRLF on Windows, LF on Unix)

export type LineEnding = '\n' | '\r\n';

/**
 * Detect the predominant line ending in a string
 * @param content - The content to analyze
 * @returns The detected line ending ('\n' or '\r\n')
 */
export function detectLineEnding(content: string): LineEnding {
    const crlfCount = (content.match(/\r\n/g) || []).length;
    // Match LF that is not preceded by CR
    const lfOnlyCount = (content.match(/(?<!\r)\n/g) || []).length;
    
    // If more CRLF than standalone LF, use CRLF
    return crlfCount > lfOnlyCount ? '\r\n' : '\n';
}

/**
 * Normalize all line endings in a string to the target format
 * @param text - The text to normalize
 * @param target - The target line ending format
 * @returns Text with normalized line endings
 */
export function normalizeLineEndings(text: string, target: LineEnding): string {
    // First convert all line endings to LF
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Then convert to target format
    if (target === '\r\n') {
        return normalized.replace(/\n/g, '\r\n');
    }
    return normalized;
}

/**
 * Check if two strings are equal after normalizing line endings
 * @param a - First string
 * @param b - Second string
 * @returns True if equal after normalization
 */
export function equalIgnoringLineEndings(a: string, b: string): boolean {
    const normalizedA = normalizeLineEndings(a, '\n');
    const normalizedB = normalizeLineEndings(b, '\n');
    return normalizedA === normalizedB;
}

/**
 * Get a description of line ending differences between two strings
 * @param expected - The expected string
 * @param actual - The actual string
 * @returns Description of differences or null if line endings match
 */
export function describeLineEndingDifference(expected: string, actual: string): string | null {
    const expectedEnding = detectLineEnding(expected);
    const actualEnding = detectLineEnding(actual);
    
    if (expectedEnding !== actualEnding) {
        const expectedName = expectedEnding === '\r\n' ? 'CRLF (Windows)' : 'LF (Unix)';
        const actualName = actualEnding === '\r\n' ? 'CRLF (Windows)' : 'LF (Unix)';
        return `Line ending mismatch: search uses ${expectedName}, file uses ${actualName}`;
    }
    
    return null;
}
