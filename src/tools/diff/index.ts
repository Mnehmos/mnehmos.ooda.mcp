// Diff tools module - exports all diff editing functionality
// Provides edit_block, apply_diff, and get_diff_preview tools

export {
    EditBlockSchema,
    ApplyDiffSchema,
    GetDiffPreviewSchema,
    BatchEditBlocksSchema
} from './schemas.js';

export { handleEditBlock } from './editBlock.js';
export type { EditBlockArgs, EditBlockResult } from './editBlock.js';

export { handleApplyDiff } from './applyDiff.js';
export type { ApplyDiffArgs, ApplyDiffResult, DiffBlock } from './applyDiff.js';

export { handleGetDiffPreview } from './getDiffPreview.js';
export type { GetDiffPreviewArgs, GetDiffPreviewResult } from './getDiffPreview.js';

export {
    generateDiff,
    formatInlineDiff,
    formatSideBySide,
    summarizeDiff
} from './diffVisualizer.js';
export type { DiffResult, DiffHunk, DiffLine } from './diffVisualizer.js';

export {
    detectLineEnding,
    normalizeLineEndings,
    equalIgnoringLineEndings,
    describeLineEndingDifference
} from './lineEndings.js';
export type { LineEnding } from './lineEndings.js';

export {
    recursiveFuzzyIndexOf,
    getSimilarityRatio,
    findAllOccurrences,
    countOccurrences,
    fuzzySearchNearLine,
    DEFAULT_FUZZY_THRESHOLD
} from './fuzzySearch.js';
export type { FuzzyMatch } from './fuzzySearch.js';
