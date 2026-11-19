/**
 * `faust-remote-server.js` as a user starts it.
 *
 * The server itself is tested in-process by `test/unit/remote-server.test.mjs`;
 * this checks the command line: that it starts, says where, serves its root,
 * and refuses arguments it cannot use instead of starting half-configured.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { ROOT, runCli } from './runner.mjs';

test('the server starts, prints its address and serves its root', async () => {
    const child = spawn(
        process.execPath,
        [
            path.join(ROOT, 'scripts', 'faust-remote-server.js'),
            'test',
            '-port',
            '0',
            '-host',
            '127.0.0.1'
        ],
        { cwd: ROOT }
    );
    try {
        const url = await new Promise((resolve, reject) => {
            let output = '';
            child.stdout.on('data', (chunk) => {
                output += chunk;
                const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
                if (match) resolve(match[0]);
            });
            child.on('exit', (code) =>
                reject(new Error(`exited with ${code}: ${output}`))
            );
        });
        const response = await fetch(`${url}poly.dsp`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /process/);
    } finally {
        child.kill();
    }
});

test('the server refuses arguments it cannot use', () => {
    /** @type {[string[], RegExp][]} */
    const cases = [
        [[], /faust-remote-server/],
        [['no/such/dir'], /is not a directory/],
        [['test', '-port', 'many'], /invalid port/],
        [['test', '-cert', 'package.json'], /-cert and -key go together/],
        [['test', '-port'], /-port needs a value/]
    ];
    for (const [args, message] of cases) {
        const result = runCli('faust-remote-server', args);
        assert.equal(result.status, 1, `${args.join(' ')}`);
        assert.match(result.stdout + result.stderr, message, `${args.join(' ')}`);
    }
});
