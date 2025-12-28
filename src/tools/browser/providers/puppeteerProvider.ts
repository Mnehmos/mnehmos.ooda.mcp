// Puppeteer Provider Implementation

import { BrowserProvider } from '../interfaces.js';
import puppeteer, { Browser, Page } from 'puppeteer';

export class PuppeteerProvider implements BrowserProvider {
    name = 'puppeteer';
    private browser: Browser | null = null;
    private page: Page | null = null;
    private consoleLogs: string[] = [];

    async launch(headless: boolean): Promise<void> {
        if (this.browser) return;

        this.browser = await puppeteer.launch({
            headless: headless ? 'shell' : false, // 'shell' is new headless mode
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.page = await this.browser.newPage();
        this.setupConsoleListener();
    }

    private setupConsoleListener() {
        if (!this.page) return;
        
        this.page.on('console', msg => {
            const text = msg.text();
            this.consoleLogs.push(`[${msg.type()}] ${text}`);
            if (this.consoleLogs.length > 1000) {
                this.consoleLogs.shift();
            }
        });
    }

    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
            this.consoleLogs = [];
        }
    }

    async navigateTo(url: string): Promise<void> {
        if (!this.page) throw new Error('Browser not started');
        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    async getContent(format: 'html' | 'text' | 'markdown'): Promise<string> {
        if (!this.page) throw new Error('Browser not started');

        if (format === 'html') {
            return await this.page.content();
        } else if (format === 'text') {
            return await this.page.evaluate(() => document.body.innerText);
        } else {
            // Basic markdown conversion (simplified)
            // Ideally use a library like turndown, but keeping it simple for now to avoiddeps
            const text = await this.page.evaluate(() => document.body.innerText);
            return text; // Fallback to text for now
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
        await this.page.type(selector, text);
    }

    async evaluate(script: string): Promise<any> {
        if (!this.page) throw new Error('Browser not started');
        // Determine if it's a function or expression
        return await this.page.evaluate((code) => {
             // eslint-disable-next-line
            return eval(code);
        }, script);
    }

    async screenshot(): Promise<string> {
        if (!this.page) throw new Error('Browser not started');
        const buffer = await this.page.screenshot({ encoding: 'base64', fullPage: true });
        return buffer as string;
    }

    async getConsoleLogs(): Promise<string[]> {
        return [...this.consoleLogs];
    }
}
