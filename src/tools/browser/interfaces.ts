// Browser Automation Interfaces
// Defines the contract for different browser engines (Puppeteer vs Playwright)

export interface BrowserProvider {
    name: string;
    
    // Lifecycle
    launch(headless: boolean): Promise<void>;
    close(): Promise<void>;
    
    // Navigation & Content
    navigateTo(url: string): Promise<void>;
    getContent(format: 'html' | 'text' | 'markdown'): Promise<string>;
    
    // Interaction
    click(selector: string): Promise<void>;
    type(selector: string, text: string): Promise<void>;
    evaluate(script: string): Promise<any>;
    
    // Capture
    screenshot(): Promise<string>; // Returns base64 string
    getConsoleLogs(): Promise<string[]>;
}
