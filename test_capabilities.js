
/**
 * MCP Capabilities Demo
 * This script acts as an MCP client to verify the functionality of mcp-ooda-computer v2.0.
 * It demonstrates:
 * 1. Desktop Automation: Launching an app, finding its window, moving it, and taking a screenshot.
 * 2. Input Simulation: Typing text into the application.
 * 3. Browser Automation: Launching a browser, navigating, capturing content, and screenshotting.
 * 4. Popup Handling: Detecting and interacting with a dialog popup.
 */

import { spawn } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const PROCESS_PATH = path.join(process.cwd(), 'dist', 'index.js');
const OUTPUT_DIR = path.join(process.cwd(), 'demo_output');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

// Start the MCP Server
console.log(`Starting MCP Server: ${PROCESS_PATH}`);
const serverProcess = spawn('node', [PROCESS_PATH], {
    stdio: ['pipe', 'pipe', 'inherit']
});

const rl = readline.createInterface({
    input: serverProcess.stdout,
    terminal: false
});

let messageId = 0;
const pendingRequests = new Map();

// JSON-RPC Helper
function sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = messageId++;
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };
        
        pendingRequests.set(id, { resolve, reject });
        const jsonLine = JSON.stringify(request) + '\n';
        serverProcess.stdin.write(jsonLine);
    });
}

// Handle Server Responses
rl.on('line', (line) => {
    try {
        const response = JSON.parse(line);
        if (response.id !== undefined && pendingRequests.has(response.id)) {
            const { resolve, reject } = pendingRequests.get(response.id);
            pendingRequests.delete(response.id);
            
            if (response.error) {
                // MCP Protocol Error
                reject(response.error);
            } else {
                resolve(response.result);
            }
        }
    } catch (e) {
        console.error('Failed to parse response:', line);
    }
});

// Call Tool Helper
async function callTool(name, args) {
    console.log(`\n[TOOL] ${name}...`);
    try {
        const result = await sendRequest('tools/call', {
            name,
            arguments: args
        });
        
        if (result.isError) {
            console.error(`❌ Tool Execution Failed:`);
            console.error(JSON.stringify(result.content, null, 2));
            throw new Error('Tool execution failed');
        }
        
        console.log(`✅ Success`);
        
        // Return structured content or just text 
        return result; 
    } catch (error) {
        console.error(`❌ Error calling ${name}:`, error);
        throw error;
    }
}

// Main Demo Sequence
async function runDemo() {
    try {
        // Wait for server init
        await wait(2000);
        
        console.log('\n=== 🖥️ DESKTOP AUTOMATION DEMO ===');
        
        // 1. Launch Application (Notepad)
        console.log('1. Launching Notepad...');
        await callTool('launch_application', { path: 'notepad' });
        await wait(5000); // Wait longer for open
        
        // 2. Find the Window
        console.log('2. Finding Window...');
        const windowsResult = await callTool('list_windows', {});
        const resultJson = JSON.parse(windowsResult.content[0].text);
        const windowsJson = resultJson.windows || [];
        
        console.log(`   Found ${windowsJson.length} windows.`);
        
        // Note: Filter logic might need adjustment based on exact window title
        const notepadWindow = windowsJson.find(w => w.title && w.title.toLowerCase().includes('notepad'));
        
        let notepadPid = 0;
        if (notepadWindow) {
            console.log(`   Found: "${notepadWindow.title}" (PID: ${notepadWindow.pid})`);
            notepadPid = notepadWindow.pid;
            
            // 3. Move Window
            console.log('3. Moving Window to (100, 100)...');
            await callTool('move_window', { 
                title: notepadWindow.title,
                x: 100,
                y: 100
            });
            await wait(500);

            // 4. Input Simulation (Type text)
            // Focus first
            await callTool('focus_window', { title: notepadWindow.title });
            await wait(500);
            
            console.log('4. Typing text...');
            // Using batch_keyboard_actions for typing + enter
            await callTool('keyboard_type', { text: "Hello from MCP OODA Computer!" });
            await callTool('keyboard_press', { key: "enter" });
            await callTool('keyboard_type', { text: "Automation is working." });
            
            // 5. Screenshot
            console.log('5. Capturing Screenshot...');
            const screenshotPath = path.join(OUTPUT_DIR, 'desktop_screenshot.png');
            await callTool('screenshot', { 
                savePath: screenshotPath,
                region: { x: 0, y: 0, width: 800, height: 600 } 
            });
            console.log(`   Saved to ${screenshotPath}`);
        } else {
            console.log('   Warning: Notepad window not found, skipping specific window tests.');
        }
        
        // --- POPUP HANDLING TEST ---
        console.log('\n=== 🚨 POPUP HANDLING DEMO ===');
        const popupScript = path.join(__dirname, 'popup.vbs');
        console.log(`   Launching popup script: ${popupScript}`);
        await callTool('launch_application', { path: popupScript, args: [] }); // Start asynchronous
        
        console.log('   Waiting for popup to appear...');
        await wait(2000);
        
        const popupWindowsResult = await callTool('list_windows', {});
        const popupList = JSON.parse(popupWindowsResult.content[0].text).windows || [];
        // Look for "Test Popup"
        const testPopup = popupList.find(w => w.title === 'Test Popup');
        
        if (testPopup) {
            console.log(`SUCCESS: Detected popup window "Test Popup" (PID: ${testPopup.pid})`);
            
            console.log('   Focusing popup...');
            await callTool('focus_window', { title: 'Test Popup' });
            await wait(500);
            
            console.log('   Sending ENTER to close popup...');
            await callTool('keyboard_press', { key: 'enter' });
            
            await wait(1000);
            // Verify closed
            const checkWindowsResult = await callTool('list_windows', {});
            const checkList = JSON.parse(checkWindowsResult.content[0].text).windows || [];
            if (!checkList.find(w => w.title === 'Test Popup')) {
                console.log('✅ SUCCESS: Popup closed successfully.');
            } else {
                console.error('❌ FAILURE: Popup still exists.');
            }
        } else {
            console.error('❌ FAILURE: Did not detect "Test Popup" window.');
            console.log('   Visible windows:', popupList.map(w => w.title).join(', '));
        }

        console.log('\n=== 🌐 BROWSER AUTOMATION DEMO ===');
        
        // 6. Launch Browser
        console.log('6. Launching Browser...');
        await callTool('launch_browser', { headless: true }); // Headless for speed/silence
        
        // 7. Navigate
        const url = 'https://example.com';
        console.log(`7. Navigating to ${url}...`);
        await callTool('navigate_page', { url });
        
        // 8. Get Content
        console.log('8. Fetching Content...');
        const contentResult = await callTool('get_page_content', { format: 'text' });
        const contentText = contentResult.content[0].text;
        console.log(`   Title/Header: ${contentText.split('\n')[0].trim()}`);
        
        // 9. Screenshot Page
        console.log('9. Capturing Full Page Screenshot...');
        const browserScreenshotPath = path.join(OUTPUT_DIR, 'browser_screenshot.png');
        const browserShotResult = await callTool('screenshot_page', {});
        
        // Extract base64 image data
        const imageContent = browserShotResult.content.find(c => c.type === 'image');
        if (imageContent) {
            fs.writeFileSync(browserScreenshotPath, Buffer.from(imageContent.data, 'base64'));
            console.log(`   Saved to ${browserScreenshotPath}`);
        } else {
            console.log('   Warning: No image data returned');
        }

        // 10. Cleanup Browser
        console.log('10. Closing Browser...');
        await callTool('close_browser', {});
        
        // 11. Cleanup Desktop App
        if (notepadPid) {
            console.log('11. Closing Notepad...');
            await callTool('kill_process', { pid: notepadPid, force: true });
        }
        
        console.log('\n✅ DEMO COMPLETE successfully!');
        
    } catch (error) {
        console.error('\n❌ DEMO FAILED:', error);
    } finally {
        serverProcess.kill();
        process.exit(0);
    }
}

runDemo();
