import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb } from '../storage/db.js';
import { handleBatchSearchInFiles, handleSearchInFile } from './fileSearch.js';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ooda-file-search-'));

function parseResult(result: { content: Array<{ text: string }> }) {
    return JSON.parse(result.content[0].text);
}

after(async () => {
    await closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('file search tools', () => {
    it('returns case-insensitive matches with bounded context', async () => {
        const filePath = path.join(TEST_DIR, 'context.txt');
        fs.writeFileSync(filePath, 'before\nNeedle here\nafter\nNEEDLE again\n');

        const result = await handleSearchInFile({
            path: filePath,
            pattern: 'needle',
            caseSensitive: false,
            contextLines: 1
        });
        const data = parseResult(result);

        assert.equal(data.matchCount, 2);
        assert.equal(data.truncated, false);
        assert.deepEqual(data.matches[0].context, {
            before: [{ lineNumber: 1, line: 'before' }],
            after: [{ lineNumber: 3, line: 'after' }]
        });
    });

    it('reports invalid regular expressions without throwing', async () => {
        const filePath = path.join(TEST_DIR, 'invalid-regex.txt');
        fs.writeFileSync(filePath, 'content');

        const result = await handleSearchInFile({
            path: filePath,
            pattern: '[',
            isRegex: true
        });

        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /Invalid regex pattern/);
    });

    it('supports batch fuzzy matching and preserves per-file results', async () => {
        const exactPath = path.join(TEST_DIR, 'exact.txt');
        const fuzzyPath = path.join(TEST_DIR, 'fuzzy.txt');
        fs.writeFileSync(exactPath, 'The quick brown fox');
        fs.writeFileSync(fuzzyPath, 'The quik brown fox');

        const result = await handleBatchSearchInFiles({
            searches: [
                { path: exactPath, pattern: 'quick' },
                { path: fuzzyPath, pattern: 'quick' }
            ],
            isFuzzy: true,
            fuzzyThreshold: 0.75
        });
        const data = parseResult(result);

        assert.equal(data.summary.successful, 2);
        assert.equal(data.summary.failed, 0);
        assert.ok(data.summary.totalMatches >= 2);
        assert.equal(data.results.length, 2);
        assert.ok(data.results[1].matches[0].matchedText.includes('quik'));
    });
});
