/**
 * The two scripts of Max `js` objects in assets/max (classic js, ES5),
 * run in Node's `vm` with fakes of what Max gives them: `outlet`,
 * `arrayfromargs`, `messagename`, `jsarguments`, `Task`, and for
 * faust-params.js the patch's named parameters (`ParameterInfoProvider`,
 * `ParameterListener`). What faustgen~ and Max do with the messages is
 * checked in Max itself; this checks what the scripts make of them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { ROOT } from './runner.mjs';

/**
 * Load a Max js script in a context of its own.
 *
 * @param {string} file - in assets/max
 * @param {string[]} args - the object's arguments, after the script's name
 * @param {Record<string, { type: string, min?: number, max?: number, enum?: string[] | string, value: number }>} [parameters]
 */
const loadMaxJs = (file, args = [], parameters = {}) => {
    /** @type {any[][]} */
    const out = [];
    /** @type {(() => void)[]} */
    const tasks = [];
    /** @type {Map<string, ((data: any) => void)[]>} */
    const watchers = new Map();
    const context = {
        jsarguments: [file, ...args],
        patcher: { name: 'demo' },
        messagename: '',
        post: () => {},
        // outlet(0, a, b) and outlet(0, [a, b]) send the same message;
        // copied, since an array of the script's realm is not one of ours
        outlet: (/** @type {number} */ _n, /** @type {any[]} */ ...message) =>
            out.push(
                message.length === 1 && typeof message[0] === 'object' && message[0] !== null
                    ? Array.from(message[0])
                    : message
            ),
        arrayfromargs: (/** @type {any[]} */ ...parts) =>
            parts.flatMap((part) => (typeof part === 'object' && part !== null ? Array.from(part) : [part])),
        Task: class {
            constructor(/** @type {() => void} */ fn) {
                this.interval = 0;
                tasks.push(fn);
            }
            repeat() {}
            cancel() {}
        },
        ParameterInfoProvider: class {
            getnames() {
                return Object.keys(parameters);
            }
            getinfo(/** @type {string} */ name) {
                const { value: _value, ...info } = parameters[name];
                return { longname: name, ...info };
            }
        },
        ParameterListener: class {
            constructor(/** @type {string} */ name, /** @type {(data: any) => void} */ fn) {
                this.name = name;
                this.silent = 0;
                const list = watchers.get(name) ?? [];
                list.push((data) => !this.silent && fn(data));
                watchers.set(name, list);
            }
            getvalue() {
                return parameters[this.name].value;
            }
            setvalue(/** @type {number} */ value) {
                parameters[this.name].value = value;
                for (const watch of watchers.get(this.name) ?? []) watch({ name: this.name, value });
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'max', file), 'utf8'), context);
    const g = /** @type {any} */ (context);
    return {
        out,
        /** Send a message as Max would: a function of the script by that name, or `anything`. */
        send(/** @type {string} */ name, /** @type {any[]} */ ...args) {
            g.messagename = name;
            const fn = typeof g[name] === 'function' && name !== 'anything' ? g[name] : g.anything;
            fn.apply(g, args);
        },
        /** A list message, as faustgen~'s control outlet sends one. */
        list(/** @type {any[]} */ ...args) {
            g.messagename = 'list';
            g.list.apply(g, args);
        },
        /** The 30 Hz task's next run. */
        tick() {
            for (const task of tasks) task();
        },
        /** A parameter moved in the patch. */
        move(/** @type {string} */ name, /** @type {number} */ value) {
            parameters[name].value = value;
            for (const watch of watchers.get(name) ?? []) watch({ name, value });
        },
        global: g
    };
};

// ------------------------------------------------------------ faust-json.js

test('faust-json.js passes faustgen~ JSON on, and again on getjson', () => {
    const js = loadMaxJs('faust-json.js');
    js.send('anything', '{"name":"x"}');
    assert.deepEqual(js.out, [['json', '{"name":"x"}']]);
    js.send('getjson');
    assert.deepEqual(js.out.at(-1), ['json', '{"name":"x"}']);
});

test('faust-json.js thins the control outlet lists to the values that changed', () => {
    const js = loadMaxJs('faust-json.js');
    // At every block, as faustgen~ does: [path, current, min, max]
    js.list('/x/level', 0.5, 0, 1);
    js.list('/x/level', 0.6, 0, 1);
    js.list('/x/freq', 440, 20, 2000);
    js.tick();
    assert.deepEqual(js.out, [['values', '/x/level', 0.6, '/x/freq', 440]]);
    js.list('/x/level', 0.6, 0, 1);
    js.list('/x/freq', 660, 20, 2000);
    js.tick();
    assert.deepEqual(js.out.at(-1), ['values', '/x/freq', 660]);
    js.tick();
    assert.equal(js.out.length, 2, 'nothing changed, nothing sent');
});

// ---------------------------------------------------------- faust-params.js

const PARAMETERS = () => ({
    cutoff: { type: 'float', min: 20, max: 2000, value: 440 },
    steps: { type: 'int', min: 1, max: 16, value: 4 },
    play: { type: 'enum', enum: ['off', 'on'], value: 0 },
    wave: { type: 'enum', enum: 'sine saw square', value: 1 }
});

test("faust-params.js builds a Faust JSON from the patch's parameters", () => {
    const js = loadMaxJs('faust-params.js', ['meters', 'level', 'db:-60:0'], PARAMETERS());
    js.send('loadbang');
    const [name, text] = js.out[0];
    assert.equal(name, 'json');
    const meta = JSON.parse(text);
    assert.equal(meta.name, 'demo');
    const items = meta.ui[0].items;
    const by = Object.fromEntries(items.map((/** @type {any} */ item) => [item.label, item]));
    assert.deepEqual(
        [by.cutoff.type, by.cutoff.address, by.cutoff.min, by.cutoff.max, by.cutoff.init],
        ['hslider', '/demo/cutoff', 20, 2000, 440]
    );
    assert.deepEqual([by.steps.type, by.steps.step, by.steps.init], ['nentry', 1, 4]);
    assert.equal(by.play.type, 'checkbox');
    assert.deepEqual(
        [by.wave.type, by.wave.max, by.wave.meta],
        ['nentry', 2, [{ style: "menu{'sine':0;'saw':1;'square':2}" }]]
    );
    assert.deepEqual([by.level.type, by.level.min, by.level.max], ['hbargraph', 0, 1]);
    assert.deepEqual([by.db.min, by.db.max], [-60, 0]);
});

test('faust-params.js takes a name, and makes labels into Faust path segments', () => {
    const js = loadMaxJs('faust-params.js', ['name', 'my synth'], {
        'filter cutoff': { type: 'float', min: 0, max: 1, value: 0 }
    });
    js.send('loadbang');
    const meta = JSON.parse(js.out[0][1]);
    assert.equal(meta.ui[0].items[0].address, '/my_synth/filter_cutoff');
    assert.equal(meta.ui[0].items[0].label, 'filter cutoff');
});

test('faust-params.js reports moves, sets on pset, and sends every value with the JSON', () => {
    const js = loadMaxJs('faust-params.js', ['meters', 'level'], PARAMETERS());
    js.send('loadbang');
    js.tick();
    // Every current value, after the JSON
    assert.deepEqual(js.out[1], ['pvalues', 'cutoff', 440, 'steps', 4, 'play', 0, 'wave', 1]);
    js.move('cutoff', 880);
    js.send('meter', 'level', 0.25);
    js.tick();
    assert.deepEqual(js.out[2], ['pvalues', 'cutoff', 880, 'level', 0.25]);
    // From a phone: the parameter is set, and reported like any move
    js.send('pset', 'steps', 8);
    js.tick();
    assert.deepEqual(js.out[3], ['pvalues', 'steps', 8]);
    // An unknown name is ignored
    js.send('pset', 'nope', 1);
    js.tick();
    assert.equal(js.out.length, 4);
    // getjson: the JSON and every value again
    js.send('getjson');
    js.tick();
    assert.equal(js.out[4][0], 'json');
    assert.deepEqual(js.out[5].slice(0, 3), ['pvalues', 'cutoff', 880]);
});
