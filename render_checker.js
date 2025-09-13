const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--font-render-hinting=none',
                '--enable-precise-memory-info'
            ]
        });
        console.log('Browser launched.');

        const page = await browser.newPage();
        const consoleMessages = [];
        const initialMetrics = {};
        const finalMetrics = {};

        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            consoleMessages.push({ type, text });
        });

        page.on('pageerror', error => {
            consoleMessages.push({ type: 'pageerror', text: `Page error: ${error.message}`, stack: error.stack });
        });
        
        page.on('requestfailed', request => {
            consoleMessages.push({ type: 'requestfailed', text: `Request Failed: ${request.url()} (${request.failure()?.errorText || 'N/A'})`});
        });

        const filePath = path.resolve(__dirname, 'unified_asi_monitor.html');
        console.log(`Attempting to load file: ${filePath}`);

        if (!fs.existsSync(filePath)) {
            console.error('ERROR: unified_asi_monitor.html does not exist at the expected path.');
            const errorResult = { 
                loadStatus: "HTML file not found.", 
                consoleMessages: [{type: 'error', text: 'unified_asi_monitor.html does not exist.'}],
                uiCheck: {}, 
                dynamicContent: {} 
            };
            fs.writeFileSync('render_results.json', JSON.stringify(errorResult, null, 2));
            return;
        }
        
        await page.goto(`file://${filePath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('Page navigation complete (DOMContentLoaded).');

        // Initial state capture (after a very short delay for first paint)
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        initialMetrics.semanticDepthSidebar = await page.evaluate(() => document.getElementById('semantic-depth')?.textContent);
        initialMetrics.semanticDepthPanel = await page.evaluate(() => document.getElementById('qcore-semantic-depth')?.textContent);

        // Wait longer for animations and further updates
        console.log('Waiting for animations and updates...');
        await new Promise(resolve => setTimeout(resolve, 7000)); // Total 8s after DOMContentLoaded
        console.log('Finished waiting.');

        // Final state capture for dynamic content
        finalMetrics.semanticDepthSidebar = await page.evaluate(() => document.getElementById('semantic-depth')?.textContent);
        finalMetrics.semanticDepthPanel = await page.evaluate(() => document.getElementById('qcore-semantic-depth')?.textContent);
        finalMetrics.coherenceSidebar = await page.evaluate(() => document.getElementById('quantum-coherence')?.textContent);
        finalMetrics.coherencePanel = await page.evaluate(() => document.getElementById('qcore-quantum-coherence')?.textContent);
        finalMetrics.reasoningStatusSidebar = await page.evaluate(() => document.getElementById('reasoning-status')?.textContent);
        finalMetrics.reasoningStatusPanel = await page.evaluate(() => document.getElementById('qcore-reasoning-status')?.textContent);
        
        // UI and Dynamic Content Checks
        const report = await page.evaluate(() => {
            const results = {
                uiCheck: {
                    sidebarVisible: false,
                    contentAreaVisible: false,
                    quantumInterfaceVisible: false,
                    controlPanelUnifiedVisible: false,
                    metricPanelVisible: false,
                    aiConsoleVisible: false,
                    d3CanvasS3Visible: false, // For #visualization-canvas
                    threeJsCanvasS2Visible: false, // For #neural-visualization containing a canvas
                    chartJsS3Visible: false // For #system-chart
                },
                dynamicContent: {
                    quantumMetricsUpdating: 'Cannot determine (initial/final values not captured by this scope)',
                    threeJsContent: 'Not checked',
                    d3CirclePresent: false,
                    chartJsInitialized: false,
                },
                stability: 'Page appears stable (no crash detected by Puppeteer).'
            };

            const isVisible = (element) => element && (element.offsetParent !== null || window.getComputedStyle(element).display !== 'none');

            results.uiCheck.sidebarVisible = isVisible(document.querySelector('.sidebar'));
            results.uiCheck.contentAreaVisible = isVisible(document.querySelector('.content'));
            results.uiCheck.quantumInterfaceVisible = isVisible(document.getElementById('quantum-interface'));
            results.uiCheck.controlPanelUnifiedVisible = isVisible(document.getElementById('control-panel-unified'));
            results.uiCheck.metricPanelVisible = isVisible(document.querySelector('.metric-panel'));
            results.uiCheck.aiConsoleVisible = isVisible(document.querySelector('.ai-console'));
            
            // D3 Canvas (Snippet 3)
            const d3CanvasEl = document.getElementById('visualization-canvas');
            if (isVisible(d3CanvasEl)) {
                results.uiCheck.d3CanvasS3Visible = true;
                results.dynamicContent.d3CirclePresent = !!d3CanvasEl.querySelector('svg circle');
            }

            // Three.js Canvas (Snippet 2)
            const threeJsContainerEl = document.getElementById('neural-visualization');
            if (isVisible(threeJsContainerEl)) {
                const threeJsCanvas = threeJsContainerEl.querySelector('canvas');
                results.uiCheck.threeJsCanvasS2Visible = isVisible(threeJsCanvas);
                if (results.uiCheck.threeJsCanvasS2Visible) {
                    // Check if canvas has some content (very basic check, not foolproof for complex 3D)
                    const context = threeJsCanvas.getContext('webgl') || threeJsCanvas.getContext('experimental-webgl');
                    if (context && context.drawingBufferWidth > 0 && context.drawingBufferHeight > 0) {
                        results.dynamicContent.threeJsContent = 'Canvas has dimensions and a GL context, likely rendering.';
                    } else if (threeJsCanvas.toDataURL().length > 1000) { // Arbitrary length for some basic drawing
                         results.dynamicContent.threeJsContent = 'Canvas has some drawn content (toDataURL).';
                    } else {
                        results.dynamicContent.threeJsContent = 'Canvas present but appears blank or uninitialized.';
                    }
                } else {
                     results.dynamicContent.threeJsContent = 'Canvas element not found or not visible within #neural-visualization.';
                }
            }
            
            // Chart.js Canvas (Snippet 3)
            const chartJsCanvasEl = document.getElementById('system-chart');
            if (isVisible(chartJsCanvasEl) && chartJsCanvasEl.toDataURL) { // Check if it's a canvas
                 results.uiCheck.chartJsS3Visible = true;
                 // A very basic check: if it has non-trivial content. Chart.js adds a lot.
                 results.dynamicContent.chartJsInitialized = chartJsCanvasEl.toDataURL().length > 2000; 
            }

            return results;
        });

        // Combine initial and final metrics to check for updates
        report.dynamicContent.quantumMetricsUpdating = 
            `Sidebar Semantic Depth: ${initialMetrics.semanticDepthSidebar} -> ${finalMetrics.semanticDepthSidebar}. ` +
            `Panel Semantic Depth: ${initialMetrics.semanticDepthPanel} -> ${finalMetrics.semanticDepthPanel}. ` +
            `All values should ideally change and match between sidebar/panel.`;
        
        // Add captured metrics to the report for clarity
        report.dynamicContent.initialMetrics = initialMetrics;
        report.dynamicContent.finalMetrics = finalMetrics;


        console.log('UI and dynamic content evaluation complete.');

        const finalResult = {
            loadStatus: "Successfully loaded and evaluated.",
            uiCheck: report.uiCheck,
            dynamicContent: report.dynamicContent,
            stability: report.stability,
            consoleMessages: consoleMessages
        };
        
        fs.writeFileSync('render_results.json', JSON.stringify(finalResult, null, 2));
        console.log('Results saved to render_results.json');

    } catch (error) {
        console.error('Error during Puppeteer script execution:', error);
        const errorResult = {
            loadStatus: "Error during Puppeteer script execution.",
            uiCheck: { error: error.message },
            dynamicContent: { error: error.message },
            stability: "Page may be unstable or crashed.",
            consoleMessages: [{ type: 'puppeteer_error', text: error.stack, name: error.name }]
        };
        fs.writeFileSync('render_results.json', JSON.stringify(errorResult, null, 2));
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
            console.log('Browser closed.');
        }
    }
})();
