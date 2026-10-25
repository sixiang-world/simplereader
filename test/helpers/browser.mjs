import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { existsSync, createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };

export async function launchBrowser() {
    const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
    return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
}

// Serve built output at both / and /reader/ to exercise a real subpath deployment.
async function serveProduction() {
    const dist = resolve(root, 'dist');
    if (!existsSync(resolve(dist, 'index.html'))) throw new Error('Build before browser tests: npm run build');
    const server = createServer((req, res) => {
        try {
            let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            if (path.startsWith('/reader/')) path = path.slice('/reader'.length);
            const file = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
            if (!file.startsWith(dist + sep) || !existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
            const stream = createReadStream(file);
            stream.on('error', () => res.destroy());
            stream.pipe(res);
        } catch { res.writeHead(400); res.end('Bad request'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function withBrowserTest(run) {
    const vite = await createViteServer({ root, cacheDir: resolve(root, "tmp/.vite-browser-cache"), server:{ host:'127.0.0.1', port:0, open:false } });
    let production, browser;
    try {
        await vite.listen();
        production = await serveProduction();
        browser = await launchBrowser();
        await run({ browser, baseURL: `http://127.0.0.1:${vite.httpServer.address().port}`, productionURL: production.url });
    } finally {
        await browser?.close();
        await production?.close();
        await vite.close();
    }
}
