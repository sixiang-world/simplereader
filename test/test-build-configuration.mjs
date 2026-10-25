import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(tmpdir(), 'reader-build-config-'));
try {
    mkdirSync(path.join(temp, 'build-tools'));
    mkdirSync(path.join(temp, 'bin'));
    copyFileSync(path.join(root, 'build-tools/validate.sh'), path.join(temp, 'build-tools/validate.sh'));
    writeFileSync(path.join(temp, 'bin/npm'), '#!/bin/sh\necho "$*" >> "$GATE_LOG"\nif [ "$*" = "$FAIL_STEP" ]; then exit 7; fi\n', { mode: 0o755 });
    writeFileSync(path.join(temp, 'bin/python3'), '#!/bin/sh\necho python-tests >> "$GATE_LOG"\n', { mode: 0o755 });
    const log = path.join(temp, 'gate.log');
    const env = { ...process.env, PATH: path.join(temp, 'bin') + ':' + process.env.PATH, GATE_LOG: log };
    const failed = spawnSync('sh', [path.join(temp, 'build-tools/validate.sh')], { env: { ...env, FAIL_STEP: 'test' } });
    assert.equal(failed.status, 7, 'gate preserves failing test exit code');
    assert.equal(readFileSync(log, 'utf8').trim(), 'run lint\nrun typecheck\nrun build\ntest', 'later steps must not run after failed tests');
    writeFileSync(log, '');
    assert.equal(spawnSync('sh', [path.join(temp, 'build-tools/validate.sh')], { env }).status, 0);
    assert.ok(readFileSync(log, 'utf8').endsWith('run test:browser\npython-tests\n'));
    writeFileSync(log, '');
    const browserFailure = spawnSync('sh', [path.join(temp, 'build-tools/validate.sh')], { env: { ...env, FAIL_STEP: 'run test:browser' } });
    assert.equal(browserFailure.status, 7);
    assert.ok(!readFileSync(log, 'utf8').includes('python-tests'));

    const config = JSON.parse(readFileSync(path.join(root, 'edgeone.json')));
    for (const rule of config.headers) {
        const cache = rule.headers.find((h) => h.key === 'Cache-Control').value;
        assert.equal(cache.includes('immutable'), rule.source === '/assets/*', 'only content-hashed URLs are immutable');
    }

    // Run the materializer in an isolated install tree: stale bundle replacement,
    // repeatability and missing locked dependency all exercise real file IO.
    const install = path.join(temp, 'install');
    mkdirSync(path.join(install, 'build-tools'), { recursive: true });
    mkdirSync(path.join(install, 'node_modules/opencc-js/dist/umd'), { recursive: true });
    mkdirSync(path.join(install, 'client/lib/opencc'), { recursive: true });
    copyFileSync(path.join(root, 'build-tools/fetch-opencc-bundle.mjs'), path.join(install, 'build-tools/fetch-opencc-bundle.mjs'));
    const browser = path.join(install, 'client/lib/opencc/full.js');
    const locked = path.join(install, 'node_modules/opencc-js/dist/umd/full.js');
    writeFileSync(browser, 'stale browser version');
    writeFileSync(locked, 'locked dependency bytes');
    const materialize = () => spawnSync(process.execPath, [path.join(install, 'build-tools/fetch-opencc-bundle.mjs')]);
    assert.equal(materialize().status, 0);
    assert.equal(readFileSync(browser, 'utf8'), 'locked dependency bytes');
    assert.equal(materialize().status, 0);
    rmSync(locked);
    assert.equal(materialize().status, 1, 'existing stale copy cannot mask a missing dependency');
    console.log('Build configuration: fail-fast validation, cache policy and locked OpenCC bytes passed');
} finally {
    rmSync(temp, { recursive: true, force: true });
}
