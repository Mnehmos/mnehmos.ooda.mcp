// Fuzzy search implementation using Levenshtein distance
// Based on Desktop Commander's approach with recursive binary search

import { distance } from 'fastest-levenshtein';

export interface FuzzyMatch {
    start: number;
    end: number;
    value: string;
    distance: number;
    similarity: number;
}

/**
 * Default threshold for fuzzy matching (70% similarity)
 */
export const DEFAULT_FUZZY_THRESHOLD = 0.7;

/**
 * Calculate similarity ratio between two strings
 * @param a - First string
 * @param b - Second string
 * @returns Similarity ratio (0-1, where 1 is identical)
 */
export function getSimilarityRatio(a: string, b: string): number {
    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1; // Both strings are empty
    
    const levenshteinDistance = distance(a, b);
    return 1 - (levenshteinDistance / maxLength);
}

/**
 * Recursively find the closest match to a query string within text using fuzzy matching
 * Uses binary search to efficiently narrow down the search area
 * 
 * @param text - The text to search within
 * @param query - The query string to find
 * @param start - Start index in the text (default: 0)
 * @param end - End index in the text (default: text.length)
 * @param parentDistance - Best distance found so far (default: Infinity)
 * @param depth - Recursion depth for debugging (default: 0)
 * @returns Object with match details including position, value, and similarity
 */
export function recursiveFuzzyIndexOf(
    text: string, 
    query: string, 
    start: number = 0, 
    end: number | null = null, 
    parentDistance: number = Infinity,
    depth: number = 0
): FuzzyMatch {
    if (end === null) end = text.length;
    
    // For small text segments, use iterative approach for precision
    if (end - start <= 2 * query.length) {
        return iterativeReduction(text, query, start, end, parentDistance);
    }
    
    const midPoint = start + Math.floor((end - start) / 2);
    
    // Calculate overlap to ensure we don't miss matches spanning the midpoint
    const leftEnd = Math.min(end, midPoint + query.length);
    const rightStart = Math.max(start, midPoint - query.length);
    
    // Calculate distance for both halves
    const leftDistance = distance(text.substring(start, leftEnd), query);
    const rightDistance = distance(text.substring(rightStart, end), query);
    const bestDistance = Math.min(leftDistance, rightDistance, parentDistance);
    
    // If parent already has the best match, refine with iterative approach
    if (parentDistance === bestDistance) {
        return iterativeReduction(text, query, start, end, parentDistance);
    }
    
    // Recurse into the better half
    if (leftDistance < rightDistance) {
        return recursiveFuzzyIndexOf(text, query, start, leftEnd, bestDistance, depth + 1);
    } else {
        return recursiveFuzzyIndexOf(text, query, rightStart, end, bestDistance, depth + 1);
    }
}

/**
 * Iteratively refine the match by shrinking the window from both ends
 * @param text - The text to search within
 * @param query - The query string to find
 * @param start - Start index
 * @param end - End index
 * @param parentDistance - Best distance found so far
 * @returns Refined match with best position
 */
function iterativeReduction(
    text: string, 
    query: string, 
    start: number, 
    end: number, 
    parentDistance: number
): FuzzyMatch {
    let bestDistance = parentDistance;
    let bestStart = start;
    let bestEnd = end;
    
    // Improve start position by shrinking from left
    let nextDistance = distance(text.substring(bestStart + 1, bestEnd), query);
    while (nextDistance < bestDistance && bestStart + 1 < bestEnd) {
        bestDistance = nextDistance;
        bestStart++;
        nextDistance = distance(text.substring(bestStart + 1, bestEnd), query);
    }
    
    // Improve end position by shrinking from right
    nextDistance = distance(text.substring(bestStart, bestEnd - 1), query);
    while (nextDistance < bestDistance && bestStart < bestEnd - 1) {
        bestDistance = nextDistance;
        bestEnd--;
        nextDistance = distance(text.substring(bestStart, bestEnd - 1), query);
    }
    
    const value = text.substring(bestStart, bestEnd);
    const similarity = getSimilarityRatio(query, value);
    
    return {
        start: bestStart,
        end: bestEnd,
        value,
        distance: bestDistance,
        similarity
    };
}

/**
 * Find all occurrences of a substring in text (exact match)
 * @param text - The text to search within
 * @param search - The substring to find
 * @returns Array of start indices where the substring was found
 */
export function findAllOccurrences(text: string, search: string): number[] {
    const indices: number[] = [];
    let pos = text.indexOf(search);
    
    while (pos !== -1) {
        indices.push(pos);
        pos = text.indexOf(search, pos + 1);
    }
    
    return indices;
}

/**
 * Count occurrences of a substring in text
 * @param text - The text to search within
 * @param search - The substring to find
 * @returns Number of occurrences
 */
export function countOccurrences(text: string, search: string): number {
    if (search === '') return 0;
    return text.split(search).length - 1;
}

/**
 * Find the best fuzzy match near a specific line number
 * @param text - The text to search within
 * @param query - The query string to find
 * @param lineHint - Approximate line number where the match should be (1-indexed)
 * @param windowLines - Number of lines above/below to search (default: 20)
 * @returns Best match found in the window, or full-text search if not found
 */
export function fuzzySearchNearLine(
    text: string,
    query: string,
    lineHint: number,
    windowLines: number = 20
): FuzzyMatch {
    const lines = text.split('\n');
    
    // Convert 1-indexed line to 0-indexed
    const targetLine = Math.max(0, lineHint - 1);
    const startLine = Math.max(0, targetLine - windowLines);
    const endLine = Math.min(lines.length, targetLine + windowLines);
    
    // Calculate character positions for the window
    let startPos = 0;
    for (let i = 0; i < startLine; i++) {
        startPos += lines[i].length + 1; // +1 for newline
    }
    
    let endPos = startPos;
    for (let i = startLine; i < endLine; i++) {
        endPos += lines[i].length + 1;
    }
    
    // Search within the window first
    const windowMatch = recursiveFuzzyIndexOf(text, query, startPos, endPos);
    
    // If we found a good match in the window, use it
    if (windowMatch.similarity >= DEFAULT_FUZZY_THRESHOLD) {
        return windowMatch;
    }
    
    // Otherwise, search the entire text
    return recursiveFuzzyIndexOf(text, query);
}
