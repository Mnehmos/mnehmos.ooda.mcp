/**
 * Glob pattern matching shared by search_files and start_search.
 *
 * Matching is implemented as a memoized token matcher instead of compiling
 * user-controlled patterns to regular expressions. This keeps wildcard work
 * bounded by the pattern and candidate lengths and avoids regex backtracking
 * surprises on hostile input.
 *
 * Semantics:
 *   - A pattern containing a path separator is matched against the candidate's
 *     path relative to the search root (separators normalized to `/`).
 *   - A pattern with no separator is matched against the basename, preserving
 *     the previous behaviour for patterns like `*.ts` or `README.md`.
 *   - `**\/` matches zero or more leading path segments, so `**\/*.ts` matches
 *     both `a.ts` and `nested/dir/a.ts`.
 *   - `*` and `?` do not cross path separators.
 *   - `{a,b}` expands to a flat alternation.
 *   - Matching is case-insensitive, as before.
 */

const MAX_GLOB_LENGTH = 4096;
const MAX_ALTERNATIVES = 256;

type GlobToken =
    | { kind: 'literal'; value: string }
    | { kind: 'star' }
    | { kind: 'question' }
    | { kind: 'globstar' }
    | { kind: 'globstarPath' };

export interface CompiledGlob {
    /** When true, test against the relative path; otherwise the basename. */
    matchesFullPath: boolean;
    /** The original pattern, kept for diagnostics. */
    source: string;
    /** Expanded token alternatives used by globMatches. */
    alternatives: GlobToken[][];
}

function expandBraces(pattern: string): string[] {
    const open = pattern.indexOf('{');
    if (open < 0) {
        return [pattern];
    }

    const close = pattern.indexOf('}', open + 1);
    if (close <= open) {
        // Unbalanced braces are treated as literals for compatibility.
        return [pattern];
    }

    const prefix = pattern.slice(0, open);
    const suffix = pattern.slice(close + 1);
    const alternatives = pattern.slice(open + 1, close).split(',');
    return alternatives.flatMap(alternative =>
        expandBraces(`${prefix}${alternative}${suffix}`)
    );
}

function tokenize(pattern: string): GlobToken[] {
    const tokens: GlobToken[] = [];

    for (let i = 0; i < pattern.length;) {
        const char = pattern[i];

        if (char === '*') {
            let end = i;
            while (pattern[end] === '*') {
                end++;
            }

            if (end - i > 1 && pattern[end] === '/') {
                // Consume the separator as part of the globstar so it can
                // match zero directories (`**/file.ts` => `file.ts`).
                tokens.push({ kind: 'globstarPath' });
                i = end + 1;
            } else if (end - i > 1) {
                tokens.push({ kind: 'globstar' });
                i = end;
            } else {
                tokens.push({ kind: 'star' });
                i = end;
            }
            continue;
        }

        if (char === '?') {
            tokens.push({ kind: 'question' });
            i++;
            continue;
        }

        tokens.push({ kind: 'literal', value: char.toLowerCase() });
        i++;
    }

    return tokens;
}

function matchesTokens(tokens: GlobToken[], candidate: string): boolean {
    const memo = new Map<string, boolean>();

    const visit = (tokenIndex: number, candidateIndex: number): boolean => {
        const key = `${tokenIndex}:${candidateIndex}`;
        const cached = memo.get(key);
        if (cached !== undefined) {
            return cached;
        }

        let matched = false;
        const token = tokens[tokenIndex];

        if (!token) {
            matched = candidateIndex === candidate.length;
        } else if (token.kind === 'literal') {
            matched = candidate[candidateIndex] === token.value
                && visit(tokenIndex + 1, candidateIndex + 1);
        } else if (token.kind === 'question') {
            matched = candidateIndex < candidate.length
                && candidate[candidateIndex] !== '/'
                && visit(tokenIndex + 1, candidateIndex + 1);
        } else if (token.kind === 'star') {
            // Try every position in the current path segment. Memoization
            // ensures each token/candidate state is evaluated only once.
            for (let index = candidateIndex; index <= candidate.length; index++) {
                if (index < candidate.length && candidate[index] === '/') {
                    break;
                }
                if (visit(tokenIndex + 1, index)) {
                    matched = true;
                    break;
                }
            }
        } else if (token.kind === 'globstarPath') {
            // First try zero directories, then consume one complete segment
            // at a time while staying on the same globstar token.
            matched = visit(tokenIndex + 1, candidateIndex);
            if (!matched) {
                for (let index = candidateIndex; index < candidate.length; index++) {
                    if (candidate[index] === '/' && visit(tokenIndex, index + 1)) {
                        matched = true;
                        break;
                    }
                }
            }
        } else {
            // A trailing `**` can cross path separators.
            matched = visit(tokenIndex + 1, candidateIndex)
                || (candidateIndex < candidate.length && visit(tokenIndex, candidateIndex + 1));
        }

        memo.set(key, matched);
        return matched;
    };

    return visit(0, 0);
}

/** Compile a glob pattern into a reusable token matcher. */
export function compileGlob(pattern: string): CompiledGlob {
    const normalized = pattern.replace(/\\/g, '/');
    if (normalized.length > MAX_GLOB_LENGTH) {
        throw new Error(`Glob pattern exceeds the ${MAX_GLOB_LENGTH}-character limit`);
    }

    const expanded = expandBraces(normalized);
    if (expanded.length > MAX_ALTERNATIVES) {
        throw new Error(`Glob pattern expands to more than ${MAX_ALTERNATIVES} alternatives`);
    }

    return {
        matchesFullPath: normalized.includes('/'),
        source: pattern,
        alternatives: expanded.map(tokenize),
    };
}

/**
 * Test a filesystem entry against a compiled glob.
 *
 * @param glob         Result of compileGlob().
 * @param relativePath Path of the entry relative to the search root.
 * @param basename     Entry name on its own.
 */
export function globMatches(glob: CompiledGlob, relativePath: string, basename: string): boolean {
    const candidate = (glob.matchesFullPath ? relativePath : basename)
        .replace(/\\/g, '/')
        .toLowerCase();
    return glob.alternatives.some(alternative => matchesTokens(alternative, candidate));
}
