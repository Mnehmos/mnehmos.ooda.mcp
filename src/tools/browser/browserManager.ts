// Browser Manager
// Singleton managing the active provider and fallback logic

import { BrowserProvider } from './interfaces.js';
import { PuppeteerProvider } from './providers/puppeteerProvider.js';
import { PlaywrightProvider } from './providers/playwrightProvider.js';
import { logAudit } from '../../audit.js';

export class BrowserManager {
    private static instance: BrowserManager;
    private provider: BrowserProvider | null = null;
    private activeEngine: 'puppeteer' | 'playwright' | null = null;

    private constructor() {}

    static getInstance(): BrowserManager {
        if (!BrowserManager.instance) {
            BrowserManager.instance = new BrowserManager();
        }
        return BrowserManager.instance;
    }

    async launch(engine: 'auto' | 'puppeteer' | 'playwright' = 'auto', headless: boolean = true) {
        if (this.provider) {
            await this.close();
        }

        if (engine === 'puppeteer') {
            await this.tryLaunchPuppeteer(headless);
        } else if (engine === 'playwright') {
            await this.tryLaunchPlaywright(headless);
        } else {
            // Auto mode: Try Puppeteer first, then Playwright
            try {
                await this.tryLaunchPuppeteer(headless);
            } catch (error: any) {
                console.warn(`Puppeteer launch failed: ${error.message}. Falling back to Playwright.`);
                await logAudit('launch_browser_fallback', { error: error.message }, 'falling back to playwright');
                await this.tryLaunchPlaywright(headless);
            }
        }
    }

    private async tryLaunchPuppeteer(headless: boolean) {
        const provider = new PuppeteerProvider();
        await provider.launch(headless);
        this.provider = provider;
        this.activeEngine = 'puppeteer';
    }

    private async tryLaunchPlaywright(headless: boolean) {
        const provider = new PlaywrightProvider();
        await provider.launch(headless);
        this.provider = provider;
        this.activeEngine = 'playwright';
    }

    async close() {
        if (this.provider) {
            await this.provider.close();
            this.provider = null;
            this.activeEngine = null;
        }
    }

    getProvider(): BrowserProvider {
        if (!this.provider) {
            throw new Error('Browser not started. Call launch_browser first.');
        }
        return this.provider;
    }

    getActiveEngine(): string | null {
        return this.activeEngine;
    }
}
