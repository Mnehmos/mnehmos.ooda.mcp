import { test, describe } from 'node:test';
import assert from 'node:assert';
import { compileGlob, globMatches } from './glob.js';

/** Convenience wrapper: does `relPath` match `pattern`? */
function matches(pattern: string, relPath: string): boolean {
    const basename = relPath.split(/[\\/]/).pop()!;
    return globMatches(compileGlob(pattern), relPath, basename);
}

describe('compileGlob / globMatches', () => {
    describe('regression: path-scoped patterns (issue #5)', () => {
        test('**/*.ts matches files at the search root', () => {
            assert.strictEqual(matches('**/*.ts', 'index.ts'), true);
        });

        test('**/*.ts matches nested files', () => {
            assert.strictEqual(matches('**/*.ts', 'tools/diff/schemas.ts'), true);
        });

        test('**/*.ts does not match other extensions', () => {
            assert.strictEqual(matches('**/*.ts', 'tools/README.md'), false);
        });

        test('**/*.json matches nested json (the pattern in the tool schema)', () => {
            assert.strictEqual(matches('**/*.json', 'a/b/package.json'), true);
        });

        test('directory-scoped pattern only matches inside that directory', () => {
            assert.strictEqual(matches('tools/*.ts', 'tools/cli.ts'), true);
            assert.strictEqual(matches('tools/*.ts', 'storage/db.ts'), false);
        });

        test('single * does not cross a path separator', () => {
            assert.strictEqual(matches('tools/*.ts', 'tools/diff/schemas.ts'), false);
        });

        test('trailing ** matches across separators', () => {
            assert.strictEqual(matches('tools/**', 'tools/diff/schemas.ts'), true);
        });

        test('backslash separators in the pattern are normalized', () => {
            assert.strictEqual(matches('tools\\*.ts', 'tools/cli.ts'), true);
        });

        test('backslash separators in the candidate are normalized', () => {
            assert.strictEqual(matches('tools/*.ts', 'tools\\cli.ts'), true);
        });
    });

    describe('backwards compatibility: separator-free patterns match the basename', () => {
        test('*.ts matches a nested file by basename', () => {
            assert.strictEqual(matches('*.ts', 'storage/db.ts'), true);
        });

        test('exact name matches a directory entry', () => {
            assert.strictEqual(matches('diff', 'tools/diff'), true);
        });

        test('non-matching extension is rejected', () => {
            assert.strictEqual(matches('*.ts', 'tools/README.md'), false);
        });

        test('matching is case-insensitive', () => {
            assert.strictEqual(matches('*.TS', 'index.ts'), true);
        });
    });

    describe('wildcards', () => {
        test('? matches exactly one character', () => {
            assert.strictEqual(matches('a?c.ts', 'abc.ts'), true);
            assert.strictEqual(matches('a?c.ts', 'ac.ts'), false);
        });

        test('? does not match a path separator', () => {
            assert.strictEqual(matches('a?c.ts', 'a/c.ts'), false);
        });

        test('brace alternation expands', () => {
            assert.strictEqual(matches('*.{ts,js}', 'index.ts'), true);
            assert.strictEqual(matches('*.{ts,js}', 'index.js'), true);
            assert.strictEqual(matches('*.{ts,js}', 'index.md'), false);
        });

        test('dots are literal, not regex wildcards', () => {
            assert.strictEqual(matches('a.ts', 'axts'), false);
        });

        test('an unbalanced brace is treated literally', () => {
            assert.strictEqual(matches('a{b.ts', 'a{b.ts'), true);
        });
    });

    describe('compileGlob metadata', () => {
        test('flags path-scoped patterns', () => {
            assert.strictEqual(compileGlob('**/*.ts').matchesFullPath, true);
            assert.strictEqual(compileGlob('src/*.ts').matchesFullPath, true);
        });

        test('flags basename patterns', () => {
            assert.strictEqual(compileGlob('*.ts').matchesFullPath, false);
        });

        test('preserves the source pattern for diagnostics', () => {
            assert.strictEqual(compileGlob('**/*.ts').source, '**/*.ts');
        });
    });
});
