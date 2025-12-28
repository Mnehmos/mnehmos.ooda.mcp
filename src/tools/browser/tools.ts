// Browser Tool Handlers

import { z } from 'zod';
import { BrowserManager } from './browserManager.js';
import { logAudit } from '../../audit.js';
import { loadConfig } from '../../config.js';

const config = loadConfig();

/**
 * Truncate output to prevent context stuffing.
 */
function truncateOutput(output: string, maxChars: number, mode: 'head' | 'tail' | 'both'): { text: string; truncated: boolean; originalLength: number } {
    if (output.length <= maxChars) {
        return { text: output, truncated: false, originalLength: output.length };
    }

    const originalLength = output.length;
    let text: string;

    if (mode === 'head') {
        text = output.slice(0, maxChars);
        text += `\n\n⚠️ OUTPUT TRUNCATED: Showing first ${maxChars.toLocaleString()} of ${originalLength.toLocaleString()} characters.`;
    } else if (mode === 'tail') {
        text = output.slice(-maxChars);
        text = `⚠️ OUTPUT TRUNCATED: Showing last ${maxChars.toLocaleString()} of ${originalLength.toLocaleString()} characters.\n\n` + text;
    } else {
        const headSize = Math.floor(maxChars * 0.6);
        const tailSize = maxChars - headSize;
        const head = output.slice(0, headSize);
        const tail = output.slice(-tailSize);
        const omitted = originalLength - headSize - tailSize;
        text = head +
            `\n\n⚠️ OUTPUT TRUNCATED: Omitted ${omitted.toLocaleString()} characters (${Math.round(omitted/originalLength*100)}% of output).\n` +
            `📊 Total: ${originalLength.toLocaleString()} chars | Showing: first ${headSize.toLocaleString()} + last ${tailSize.toLocaleString()}\n\n` +
            tail;
    }

    return { text, truncated: true, originalLength };
}

// Schemas
export const LaunchBrowserSchema = {
    engine: z.enum(['auto', 'puppeteer', 'playwright']).optional().describe('Browser engine to use (default: auto)'),
    headless: z.boolean().optional().describe('Run in headless mode (default: true)'),
};

export const CloseBrowserSchema = {};

export const NavigatePageSchema = {
    url: z.string().describe('URL to navigate to'),
};

export const GetPageContentSchema = {
    format: z.enum(['html', 'text', 'markdown']).optional().describe('Content format (default: text)'),
};

export const ClickElementSchema = {
    selector: z.string().describe('CSS or XPath selector'),
};

export const TypeTextSchema = {
    selector: z.string().describe('CSS or XPath selector'),
    text: z.string().describe('Text to type'),
};

export const EvalJsSchema = {
    script: z.string().describe('JavaScript code to evaluate'),
};

export const ScreenshotPageSchema = {};

export const GetConsoleLogsSchema = {};

// Handlers
const manager = BrowserManager.getInstance();

export async function handleLaunchBrowser(args: { 
    engine?: 'auto' | 'puppeteer' | 'playwright'; 
    headless?: boolean 
}) {
    try {
        const engine = args.engine || 'auto';
        const headless = args.headless !== false;
        
        await manager.launch(engine, headless);
        const activeEngine = manager.getActiveEngine();

        await logAudit('launch_browser', args, { success: true, engine: activeEngine });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    engine: activeEngine,
                    mode: headless ? 'headless' : 'headful'
                }, null, 2)
            }],
        };
    } catch (error: any) {
        await logAudit('launch_browser', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleCloseBrowser() {
    try {
        await manager.close();
        await logAudit('close_browser', {}, 'closed');
        return {
            content: [{ type: 'text', text: 'Browser closed' }],
        };
    } catch (error: any) {
        await logAudit('close_browser', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleNavigatePage(args: { url: string }) {
    try {
        await manager.getProvider().navigateTo(args.url);
        await logAudit('navigate_page', args, 'success');
        return {
            content: [{ type: 'text', text: `Navigated to ${args.url}` }],
        };
    } catch (error: any) {
        await logAudit('navigate_page', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetPageContent(args: { format?: 'html' | 'text' | 'markdown' }) {
    try {
        const format = args.format || 'text';
        const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };

        const rawContent = await manager.getProvider().getContent(format);
        const result = truncateOutput(rawContent, outputConfig.maxOutputChars, outputConfig.truncateMode);

        await logAudit('get_page_content', args, `retrieved ${rawContent.length} chars${result.truncated ? ' (truncated)' : ''}`);

        return {
            content: [{
                type: 'text',
                text: result.truncated
                    ? `${result.text}\n\n📄 Page content truncated from ${result.originalLength.toLocaleString()} characters.`
                    : result.text
            }],
        };
    } catch (error: any) {
        await logAudit('get_page_content', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleClickElement(args: { selector: string }) {
    try {
        await manager.getProvider().click(args.selector);
        await logAudit('click_element', args, 'success');
        return {
            content: [{ type: 'text', text: `Clicked ${args.selector}` }],
        };
    } catch (error: any) {
        await logAudit('click_element', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleTypeText(args: { selector: string; text: string }) {
    try {
        await manager.getProvider().type(args.selector, args.text);
        await logAudit('type_text', { ...args, text: '***' }, 'success'); // Redact text in logs
        return {
            content: [{ type: 'text', text: `Typed into ${args.selector}` }],
        };
    } catch (error: any) {
        await logAudit('type_text', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleEvalJs(args: { script: string }) {
    try {
        const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };

        const result = await manager.getProvider().evaluate(args.script);
        const rawOutput = JSON.stringify(result, null, 2);
        const truncated = truncateOutput(rawOutput, outputConfig.maxOutputChars, outputConfig.truncateMode);

        await logAudit('evaluate_js', { scriptLength: args.script.length }, `result ${rawOutput.length} chars${truncated.truncated ? ' (truncated)' : ''}`);

        return {
            content: [{
                type: 'text',
                text: truncated.text
            }],
        };
    } catch (error: any) {
        await logAudit('evaluate_js', args, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleScreenshotPage() {
    try {
        const base64 = await manager.getProvider().screenshot();
        await logAudit('screenshot_page', {}, 'success');
        return {
            content: [
                { type: 'text', text: 'Screenshot captured (base64 data)' },
                { type: 'image', data: base64, mimeType: 'image/png' }
            ],
        };
    } catch (error: any) {
        await logAudit('screenshot_page', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}

export async function handleGetConsoleLogs() {
    try {
        const outputConfig = config.cliOutput ?? { maxOutputChars: 50000, warnAtChars: 10000, truncateMode: 'both' as const };
        const maxLogs = 500; // Limit number of log entries

        let logs = await manager.getProvider().getConsoleLogs();
        const totalLogs = logs.length;

        // Limit number of log entries
        if (logs.length > maxLogs) {
            logs = logs.slice(-maxLogs); // Keep most recent
        }

        const rawOutput = JSON.stringify(logs, null, 2);
        const truncated = truncateOutput(rawOutput, outputConfig.maxOutputChars, outputConfig.truncateMode);

        await logAudit('get_console_logs', {}, `retrieved ${totalLogs} logs${logs.length < totalLogs ? ` (showing last ${logs.length})` : ''}`);

        return {
            content: [{
                type: 'text',
                text: truncated.truncated
                    ? `${truncated.text}\n\n📋 Console logs: ${totalLogs} total, showing last ${logs.length}`
                    : (totalLogs > logs.length
                        ? `${truncated.text}\n\n📋 Showing last ${logs.length} of ${totalLogs} console logs`
                        : truncated.text)
            }],
        };
    } catch (error: any) {
        await logAudit('get_console_logs', {}, null, error.message);
        return {
            content: [{ type: 'text', text: `Error: ${error.message}` }],
            isError: true,
        };
    }
}
