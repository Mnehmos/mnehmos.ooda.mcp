// Playwright Provider Implementation

import { BrowserProvider } from '../interfaces.js';
import { chromium, Browser, Page, BrowserContext } from 'playwright';

export class PlaywrightProvider implements BrowserProvider {
    name = 'playwright';
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private consoleLogs: string[] = [];

    async launch(headless: boolean): Promise<void> {
        if (this.browser) return;

        this.browser = await chromium.launch({
            headless: headless,
        });
        
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.setupConsoleListener();
    }

    private setupConsoleListener() {
        if (!this.page) return;
        
        this.page.on('console', msg => {
            this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
            if (this.consoleLogs.length > 1000) {
                this.consoleLogs.shift();
            }
        });
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.consoleLogs = [];
        }
    }

    async navigateTo(url: string): Promise<void> {
        if (!this.page) throw new Error('Browser not started');
        await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    }

    async getContent(format: 'html' | 'text' | 'markdown'): Promise<string> {
        if (!this.page) throw new Error('Browser not started');

        if (format === 'html') {
            return await this.page.content();
        } else if (format === 'text') {
            return await this.page.innerText('body');
        } else {
             // Fallback to text for markdown
            return await this.page.innerText('body');
        }
    }

    async click(selector: string): Promise<void> {
        if (!this.page) throw new Error('Browser not started');
        await this.page.waitForSelector(selector, { timeout: 5000 });
        await this.page.click(selector);
    }

    async type(selector: string, text: string): Promise<void> {
        if (!this.page) throw new Error('Browser not started');
        await this.page.waitForSelector(selector, { timeout: 5000 });
        await this.page.fill(selector, text);
    }

    async evaluate(script: string): Promise<any> {
        if (!this.page) throw new Error('Browser not started');
        return await this.page.evaluate(script); // Playwright evaluate accepts string or body
    }

    async screenshot(): Promise<string> {
        if (!this.page) throw new Error('Browser not started');
        const buffer = await this.page.screenshot({ fullPage: true });
        return buffer.toString('base64');
    }

    async getConsoleLogs(): Promise<string[]> {
        return [...this.consoleLogs];
    }
}
