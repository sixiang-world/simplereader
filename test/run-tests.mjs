import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const browser = process.argv.includes('--browser');
const files = readdirSync(new URL('./', import.meta.url))
    .filter(name => browser ? /^browser-.*\.mjs$/.test(name) : /^test-.*\.mjs$/.test(name))
    .sort();
if (!files.length) throw new Error('No test files found');
for (const file of files) {
    const result = spawnSync(process.execPath, ['test/' + file], { cwd:root, stdio:'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Completed ${files.length} ${browser ? 'browser' : 'Node'} test files.`);
