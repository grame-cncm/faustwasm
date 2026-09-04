/**
 * The ScriptProcessor node.
 *
 * Deprecated everywhere, and still the only audio path on older Safari, which
 * is exactly why it had no tests and needs them: nobody exercises it until
 * someone's phone is the one that goes silent. Almost every method is a
 * forward to the DSP, so what is checked is that each one reaches the method
 * it names -- a shell whose `keyOff` calls `keyOn` fails silently and
 * musically -- plus the two places where it does real work: pulling channels
 * out of the audio process event, and the sensor handlers.
 *
 * `FaustScriptProcessorNode` extends `globalThis.ScriptProcessorNode` at
 * module evaluation time, so the fake has to be installed on the global before
 * the bundle is imported. That is why this file imports it dynamically.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Calls recorded by the fake DSP, as [method, ...args]. */
let log = [];

/**
 * A DSP that records every call instead of computing.
 *
 * Every method the node forwards to is present, so a forward that goes to the
 * wrong one shows up as the wrong name in the log rather than a crash.
 */
const makeDsp = (inputs = 1, outputs = 2) => ({
    hasAccInput: false,
    hasGyrInput: false,
    getNumInputs: () => inputs,
    getNumOutputs: () => outputs,
    compute: (...args) => log.push(['compute', ...args]),
    start: () => log.push(['start']),
    stop: () => log.push(['stop']),
    destroy: () => log.push(['destroy']),
    init: () => log.push(['init']),
    instanceInit: () => log.push(['instanceInit']),
    instanceClear: () => log.push(['instanceClear']),
    instanceConstants: () => log.push(['instanceConstants']),
    instanceResetUserInterface: () => log.push(['instanceResetUserInterface']),
    setParamValue: (...a) => log.push(['setParamValue', ...a]),
    getParamValue: (...a) => (log.push(['getParamValue', ...a]), 0.5),
    getParams: () => (log.push(['getParams']), ['/x/y']),
    getMeta: () => (log.push(['getMeta']), { name: 'x' }),
    getJSON: () => (log.push(['getJSON']), '{}'),
    getDescriptors: () => (log.push(['getDescriptors']), []),
    getUI: () => (log.push(['getUI']), []),
    midiMessage: (...a) => log.push(['midiMessage', ...a]),
    ctrlChange: (...a) => log.push(['ctrlChange', ...a]),
    pitchWheel: (...a) => log.push(['pitchWheel', ...a]),
    keyOn: (...a) => log.push(['keyOn', ...a]),
    keyOff: (...a) => log.push(['keyOff', ...a]),
    allNotesOff: (...a) => log.push(['allNotesOff', ...a]),
    setOutputParamHandler: (...a) => log.push(['setOutputParamHandler', ...a]),
    getOutputParamHandler: () => log.push(['getOutputParamHandler']),
    callOutputParamHandler: (...a) =>
        log.push(['callOutputParamHandler', ...a]),
    setInputParamHandler: (...a) => log.push(['setInputParamHandler', ...a]),
    getInputParamHandler: () => log.push(['getInputParamHandler']),
    callInputParamHandler: (...a) => log.push(['callInputParamHandler', ...a]),
    setComputeHandler: (...a) => log.push(['setComputeHandler', ...a]),
    getComputeHandler: () => log.push(['getComputeHandler']),
    setPlotHandler: (...a) => log.push(['setPlotHandler', ...a]),
    getPlotHandler: () => log.push(['getPlotHandler']),
    propagateAcc: (...a) => log.push(['propagateAcc', ...a]),
    propagateGyr: (...a) => log.push(['propagateGyr', ...a])
});

/** An AudioProcessingEvent whose buffers hand out recognisable channels. */
const audioEvent = (inputChannels, outputChannels) => ({
    inputBuffer: { getChannelData: (chan) => inputChannels[chan] },
    outputBuffer: { getChannelData: (chan) => outputChannels[chan] }
});

/** Listeners registered on the fake window, as [type, fn, capture]. */
let listeners = [];

/**
 * Install a user agent string.
 *
 * Node 22 defines `navigator` itself, as a getter-only accessor, so plain
 * assignment throws; the node reads `navigator.userAgent` to tell Android
 * apart, which is the only reason this is here.
 *
 * @param {string} userAgent
 */
const setUserAgent = (userAgent) =>
    Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent },
        configurable: true,
        writable: true
    });

/** @type {any} */ let FaustMonoScriptProcessorNode;
/** @type {any} */ let FaustPolyScriptProcessorNode;

before(async () => {
    // The base class the node extends. A plain object-shaped stand-in is
    // enough: the node never calls up into it.
    globalThis.ScriptProcessorNode = /** @type {any} */ (class {});
    setUserAgent('test');
    // A window with just the three members the node reaches for.
    globalThis.window = /** @type {any} */ ({
        DeviceMotionEvent: function DeviceMotionEvent() {},
        addEventListener: (type, fn, capture) =>
            listeners.push(['add', type, fn, capture]),
        removeEventListener: (type, fn, capture) =>
            listeners.push(['remove', type, fn, capture])
    });
    const mod = await import('../../dist/esm/index.js');
    FaustMonoScriptProcessorNode = mod.FaustMonoScriptProcessorNode;
    FaustPolyScriptProcessorNode = mod.FaustPolyScriptProcessorNode;
});

beforeEach(() => {
    log = [];
    listeners = [];
    setUserAgent('test');
});

/** A mono node already wired to a recording DSP. */
const monoNode = (inputs = 1, outputs = 2) => {
    const dsp = makeDsp(inputs, outputs);
    const node = new FaustMonoScriptProcessorNode();
    node.setupNode(dsp);
    log = [];
    return { node, dsp };
};

/** The names of the DSP methods called, in order. */
const called = () => log.map(([name]) => name);

// ------------------------------------------------------------------- set-up

test('setting the node up starts the DSP', () => {
    const node = new FaustMonoScriptProcessorNode();
    node.setupNode(makeDsp());
    // A ScriptProcessor only runs while something drives onaudioprocess, and
    // the DSP has to be running by then.
    assert.deepEqual(called(), ['start']);
});

test('setting the node up installs an audio process handler', () => {
    const { node } = monoNode();
    assert.equal(typeof node.onaudioprocess, 'function');
});

// ------------------------------------------------------ the audio callback

test('the callback hands the DSP one channel per declared input', () => {
    const { node } = monoNode(2, 1);
    const ins = [
        new Float32Array([1]),
        new Float32Array([2]),
        new Float32Array([3])
    ];
    const outs = [new Float32Array(1), new Float32Array(1)];
    node.onaudioprocess(audioEvent(ins, outs));

    const [entry] = log;
    assert.equal(entry[0], 'compute');
    // Two inputs declared: the third channel the event offers is not taken.
    assert.equal(entry[1].length, 2);
    assert.equal(entry[1][0], ins[0]);
    assert.equal(entry[1][1], ins[1]);
});

test('the callback hands the DSP one channel per declared output', () => {
    const { node } = monoNode(1, 2);
    const ins = [new Float32Array(1)];
    const outs = [
        new Float32Array(1),
        new Float32Array(1),
        new Float32Array(1)
    ];
    node.onaudioprocess(audioEvent(ins, outs));

    const [entry] = log;
    assert.equal(entry[2].length, 2);
    // The very arrays the event handed out, so writing into them is what the
    // browser plays.
    assert.equal(entry[2][0], outs[0]);
    assert.equal(entry[2][1], outs[1]);
});

test('a DSP with no inputs asks the event for none', () => {
    const { node } = monoNode(0, 1);
    let asked = 0;
    node.onaudioprocess({
        inputBuffer: {
            getChannelData: () => {
                asked += 1;
                return new Float32Array(1);
            }
        },
        outputBuffer: { getChannelData: () => new Float32Array(1) }
    });
    // Reading a channel that does not exist throws in a real AudioBuffer.
    assert.equal(asked, 0);
});

test('each callback recomputes, it does not accumulate', () => {
    const { node } = monoNode(1, 1);
    const event = audioEvent([new Float32Array(1)], [new Float32Array(1)]);
    node.onaudioprocess(event);
    node.onaudioprocess(event);
    assert.deepEqual(called(), ['compute', 'compute']);
});

// --------------------------------------------------------- the forwarding

/**
 * Every plain forward, as [what to call on the node, the args].
 *
 * @type {[string, any[]][]}
 */
const FORWARDS = [
    ['init', []],
    ['instanceInit', []],
    ['instanceClear', []],
    ['instanceConstants', []],
    ['instanceResetUserInterface', []],
    ['start', []],
    ['stop', []],
    ['destroy', []],
    ['compute', [[], []]],
    ['setParamValue', ['/x/y', 0.25]],
    ['getParamValue', ['/x/y']],
    ['getParams', []],
    ['getMeta', []],
    ['getJSON', []],
    ['getDescriptors', []],
    ['getUI', []],
    ['midiMessage', [[144, 60, 100]]],
    ['ctrlChange', [0, 7, 64]],
    ['pitchWheel', [0, 8192]],
    ['setOutputParamHandler', [() => {}]],
    ['getOutputParamHandler', []],
    ['callOutputParamHandler', ['/x/y', 1]],
    ['setInputParamHandler', [() => {}]],
    ['getInputParamHandler', []],
    ['callInputParamHandler', ['/x/y', 1]],
    ['setComputeHandler', [() => {}]],
    ['getComputeHandler', []],
    ['setPlotHandler', [() => {}]],
    ['getPlotHandler', []]
];

for (const [method, args] of FORWARDS) {
    test(`${method} reaches the DSP's ${method}`, () => {
        const { node } = monoNode();
        node[method](...args);
        // The name matters as much as the call: a forward wired to a
        // neighbouring method would still look like it worked.
        assert.deepEqual(called(), [method]);
    });
}

test('a forward passes its arguments through unchanged', () => {
    const { node } = monoNode();
    node.setParamValue('/x/freq', 442.5);
    assert.deepEqual(log[0], ['setParamValue', '/x/freq', 442.5]);
    node.ctrlChange(1, 7, 64);
    assert.deepEqual(log[1], ['ctrlChange', 1, 7, 64]);
});

test('a forward returns what the DSP returned', () => {
    const { node } = monoNode();
    assert.equal(node.getParamValue('/x/y'), 0.5);
    assert.deepEqual(node.getParams(), ['/x/y']);
    assert.deepEqual(node.getMeta(), { name: 'x' });
});

test('the input and output counts come from the DSP', () => {
    const { node } = monoNode(3, 4);
    assert.equal(node.getNumInputs(), 3);
    assert.equal(node.getNumOutputs(), 4);
});

// ------------------------------------------------------------------- poly

test('the polyphonic node forwards the note methods', () => {
    const dsp = makeDsp();
    const node = new FaustPolyScriptProcessorNode();
    node.setupNode(dsp);
    log = [];

    node.keyOn(0, 60, 100);
    node.keyOff(0, 60, 0);
    node.allNotesOff(true);
    assert.deepEqual(log, [
        ['keyOn', 0, 60, 100],
        ['keyOff', 0, 60, 0],
        ['allNotesOff', true]
    ]);
});

// ---------------------------------------------------------------- sensors

test('a device motion event reaches the DSP', () => {
    const { node } = monoNode();
    node.handleDeviceMotion({
        accelerationIncludingGravity: { x: 1, y: 2, z: 3 }
    });
    assert.deepEqual(log, [['propagateAcc', { x: 1, y: 2, z: 3 }, false]]);
});

test('on Android the acceleration is inverted', () => {
    const { node } = monoNode();
    setUserAgent('Mozilla/5.0 (Linux; Android 13)');
    node.handleDeviceMotion({
        accelerationIncludingGravity: { x: 1, y: 2, z: 3 }
    });
    // Android reports the opposite sign from iOS; the flag is what keeps a
    // DSP behaving the same on both.
    assert.deepEqual(log, [['propagateAcc', { x: 1, y: 2, z: 3 }, true]]);
});

test('a motion event with no acceleration is dropped', () => {
    const { node } = monoNode();
    node.handleDeviceMotion({ accelerationIncludingGravity: null });
    assert.deepEqual(log, []);
});

test('a device orientation event reaches the DSP', () => {
    const { node } = monoNode();
    node.handleDeviceOrientation({ alpha: 10, beta: 20, gamma: 30 });
    assert.deepEqual(log, [
        ['propagateGyr', { alpha: 10, beta: 20, gamma: 30 }]
    ]);
});

test('sensors are only listened for when the DSP asks for them', async () => {
    const { node } = monoNode();
    await node.startSensors();
    // No [acc:] or [gyr:] metadata, so nothing to listen to.
    assert.deepEqual(listeners, []);
});

test('an accelerometer DSP subscribes and unsubscribes', async () => {
    const { node, dsp } = monoNode();
    dsp.hasAccInput = true;
    await node.startSensors();
    assert.deepEqual(
        listeners.map(([action, type]) => [action, type]),
        [['add', 'devicemotion']]
    );

    listeners = [];
    node.stopSensors();
    assert.deepEqual(
        listeners.map(([action, type]) => [action, type]),
        [['remove', 'devicemotion']]
    );
});

test('the handler removed is the one that was added', () => {
    const { node, dsp } = monoNode();
    dsp.hasAccInput = true;
    node.startSensors();
    const added = listeners.find(([action]) => action === 'add')[2];
    listeners = [];
    node.stopSensors();
    const removed = listeners.find(([action]) => action === 'remove')[2];
    // removeEventListener only matches on identity: a handler rebuilt here
    // would leave the old one subscribed for the life of the page.
    assert.equal(added, removed);
});

test('a gyroscope DSP subscribes to orientation', async () => {
    const { node, dsp } = monoNode();
    dsp.hasGyrInput = true;
    await node.startSensors();
    assert.deepEqual(
        listeners.map(([action, type]) => [action, type]),
        [['add', 'deviceorientation']]
    );
});
