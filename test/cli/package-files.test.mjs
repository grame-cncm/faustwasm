/**
 * What `npm publish` would ship from assets/max: the `files` list of
 * package.json takes the whole folder, and the root .gitignore does not
 * apply inside it, so what a user generates next to the Max examples (the
 * phones' remote control in app/, a patch copy with their address and
 * certificate paths) would be published unless assets/max/.npmignore keeps
 * it out. faust-remote-v8.js, ignored by git too, is built for the package
 * and must be shipped.
 *
 * Sentinel files are placed where a user's would be, for the time of the
 * check, and removed afterwards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT } from './runner.mjs';

const MAX = path.join(ROOT, 'assets', 'max');

test('the npm package ships the Max examples, not what a user makes next to them', { timeout: 60000 }, () => {
    const sentinels = [
        path.join(MAX, 'app', 'zz-package-test.txt'),
        path.join(MAX, 'params-app', 'zz-package-test.txt'),
        path.join(MAX, 'zz-package-test-local.maxpat')
    ];
    /** Folders made here, to remove afterwards (an existing app/ is the user's). */
    const made = [];
    try {
        for (const file of sentinels) {
            const dir = path.dirname(file);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir);
                made.push(dir);
            }
            fs.writeFileSync(file, 'not for the package\n');
        }
        const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
            cwd: ROOT,
            encoding: 'utf8'
        });
        assert.equal(result.status, 0, result.stderr);
        const files = JSON.parse(result.stdout)[0].files.map((/** @type {{ path: string }} */ f) => f.path);
        const max = files.filter((/** @type {string} */ f) => f.startsWith('assets/max/'));
        for (const file of sentinels)
            assert.ok(!files.includes(path.relative(ROOT, file)), `${path.relative(ROOT, file)} would be published`);
        assert.ok(!max.some((/** @type {string} */ f) => f.startsWith('assets/max/app/')), 'nothing of app/');
        for (const shipped of [
            'assets/max/faust-remote.js',
            'assets/max/faust-remote-v8.js',
            'assets/max/faust-json.js',
            'assets/max/faust-params.js',
            'assets/max/faust-remote-wasm-demo.maxpat',
            'assets/max/package.json'
        ])
            assert.ok(max.includes(shipped), `${shipped} is shipped`);
    } finally {
        for (const file of sentinels) fs.rmSync(file, { force: true });
        for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    }
});
