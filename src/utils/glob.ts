/**
 * Glob pattern matching shared by search_files and start_search.
 *
 * Previously both tools compiled globs with a naive `*` -> `.*` substitution and
 * tested the result against the *basename* only. That made every path-scoped
 * pattern — including the `**\/*.ts` form advertised in the tool schemas —
 * match nothing at all, silently.
 *
 * Semantics implemented here:
 *   - A pattern containing a path separator is matched against the candidate's
 *     path relative to the search root (separators normalized to `/`).
 *   - A pattern with no separator is matched against the basename, which
 *     preserves the previous behaviour for patterns like `*.ts` or `README.md`.
 *   - `**\/` matches zero or more leading path segments, so `**\/*.ts` matches
 *     both `a.ts` and `nested/dir/a.ts`.
 *   - `*` and `?` do not cross path separators.
 *   - `{a,b}` expands to an alternation (flat, non-nested).
 *   - Matching is case-insensitive, as before.
 */

export interface CompiledGlob {
    /** Anchored regex the candidate string is tested against. */
    regex: RegExp;
    /** When true, test against the relative path; otherwise the basename. */
    matchesFullPath: boolean;
    /** The original pattern, kept for diagnostics. */
    source: string;
}

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/;

function escapeLiteral(char: string): string {
    return REGEX_SPECIALS.test(char) ? `\\${char}` : char;
}

/**
 * Translate glob syntax into a regex body (unanchored).
 *
 * Recurses for brace alternatives so that wildcards inside braces get the same
 * treatment as wildcards outside them — `{*.ts,*.js}` must behave like
 * `*.{ts,js}`, not emit a bare `*` quantifier into the output.
 */
function translate(normalized: string): string {
    let out = '';
    let i = 0;

    while (i < normalized.length) {
        const char = normalized[i];

        if (char === '*') {
            let end = i;
            while (normalized[end] === '*') end++;
            const isGlobstar = end - i > 1;

            if (isGlobstar && normalized[end] === '/') {
                // `**/` — zero or more complete path segments.
                out += '(?:[^/]*\\/)*';
                i = end + 1;
            } else if (isGlobstar) {
                // Trailing `**` — anything, separators included.
                out += '.*';
                i = end;
            } else {
                // Single `*` — anything within one path segment.
                out += '[^/]*';
                i = end;
            }
            continue;
        }

        if (char === '?') {
            out += '[^/]';
            i++;
            continue;
        }

        if (char === '{') {
            // Flat alternation only — a nested `{a,{b,c}}` splits on the first
            // closing brace and yields wrong (but valid, non-throwing) output.
            const close = normalized.indexOf('}', i);
            if (close > i) {
                const alternatives = normalized.slice(i + 1, close).split(',');
                out += `(?:${alternatives.map(translate).join('|')})`;
                i = close + 1;
                continue;
            }
            // Unbalanced brace: fall through and treat it as a literal.
        }

        out += escapeLiteral(char);
        i++;
    }

    return out;
}

/**
 * Compile a glob pattern into a reusable matcher.
 */
export function compileGlob(pattern: string): CompiledGlob {
    const normalized = pattern.replace(/\\/g, '/');

    return {
        regex: new RegExp(`^${translate(normalized)}$`, 'i'),
        matchesFullPath: normalized.includes('/'),
        source: pattern,
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
    const candidate = glob.matchesFullPath ? relativePath.replace(/\\/g, '/') : basename;
    return glob.regex.test(candidate);
}
