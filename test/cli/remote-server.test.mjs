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
import { request as httpRequest } from 'node:http';
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

test('-host-port opens the relay for hosts on 127.0.0.1, beside the server', async () => {
    const child = spawn(
        process.execPath,
        [
            path.join(ROOT, 'scripts', 'faust-remote-server.js'),
            'test',
            '-port',
            '0',
            '-host',
            '127.0.0.1',
            '-host-port',
            '0'
        ],
        { cwd: ROOT }
    );
    try {
        const [server, relay] = await new Promise((resolve, reject) => {
            let output = '';
            child.stdout.on('data', (chunk) => {
                output += chunk;
                const server = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
                const relay = output.match(/ws:\/\/127\.0\.0\.1:(\d+)\/relay\/<room>/);
                if (server && relay) resolve([server[0], `http://127.0.0.1:${relay[1]}`]);
            });
            child.on('exit', (code) =>
                reject(new Error(`exited with ${code}: ${output}`))
            );
        });
        assert.notEqual(relay, server.replace(/\/$/, ''));
        // A WebSocket upgrade of the relay is accepted there; files are not served
        const status = await new Promise((resolve, reject) => {
            const request = httpRequest(`${relay}/relay/r1`, {
                headers: {
                    connection: 'Upgrade',
                    upgrade: 'websocket',
                    'sec-websocket-version': '13',
                    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ=='
                }
            });
            request.on('upgrade', (response, socket) => {
                socket.destroy();
                resolve(response.statusCode);
            });
            request.on('response', (response) => {
                response.destroy();
                resolve(response.statusCode);
            });
            request.on('error', reject);
            request.end();
        });
        assert.equal(status, 101);
        assert.equal((await fetch(`${relay}/poly.dsp`)).status, 404);
        assert.equal((await fetch(`${server}poly.dsp`)).status, 200);
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
        [['test', '-port'], /-port needs a value/],
        [['test', '-allow-origin', 'https://example.org/path'], /wants an origin/],
        [['test', '-allow-origin', 'example.org'], /wants an origin/],
        [['test', '-host-port', 'many'], /invalid host port/],
        [['test', '-host-port', '70000'], /invalid host port/]
    ];
    for (const [args, message] of cases) {
        const result = runCli('faust-remote-server', args);
        assert.equal(result.status, 1, `${args.join(' ')}`);
        assert.match(result.stdout + result.stderr, message, `${args.join(' ')}`);
    }
});
