/** Exercise the production resolver rather than a copy of its implementation. */
import assert from "node:assert/strict";
import { resolveWorkerUrl, createWorker } from "../client/src/utils/helpers/worker.js";

const worker = "client/src/modules/database/db-worker.js";
const cases = [
    [worker, "https://reader.example/assets/index-hash.js", "https://reader.example/" + worker],
    [worker, "https://reader.example/reader/assets/index-hash.js", "https://reader.example/reader/" + worker],
    [worker, "https://reader.example/reader/client/src/modules/file/file-processor.js", "https://reader.example/reader/" + worker],
    ["shared/utils/logger.js", "https://reader.example/reader/client/src/modules/database/db-worker.js", "https://reader.example/reader/shared/utils/logger.js"],
    ["shared/core/file/file-processor-core.js", "https://reader.example/client/client/src/modules/file/file-processor-worker.js", "https://reader.example/client/shared/core/file/file-processor-core.js"],
    ["https://cdn.example/worker.js", "https://reader.example/reader/assets/index.js", "https://cdn.example/worker.js"],
];
for (const [path, base, expected] of cases) assert.equal(resolveWorkerUrl(path, base), expected);

const originalLocation = globalThis.location;
const originalWorker = globalThis.Worker;
const originalChrome = globalThis.chrome;
try {
    globalThis.location = { protocol: "chrome-extension:", origin: "chrome-extension://test" };
    globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://test/${path}` } };
    globalThis.Worker = class { constructor(url) { this.url = url; } };
    assert.equal(createWorker(worker, "chrome-extension://test/assets/index.js").url, `chrome-extension://test/${worker}`);
} finally {
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker;
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
}
console.log(`${cases.length + 1} worker URL behavior checks passed`);
