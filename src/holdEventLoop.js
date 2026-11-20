//@ts-check

// Why the faust2*Files functions keep the event loop busy while they work.
//
// When libuv has no handle left, Node does not sleep in the loop: it calls
// NodePlatform::DrainTasks, which first blocks until every task on V8's
// worker threads has finished, and only then runs the tasks those workers
// posted back to the main thread. Awaiting a promise that only V8 settles
// (WebAssembly.compile and instantiate, which libfaust-wasm and every
// compiled DSP go through) leaves no handle, so the main thread waits there.
//
// A concurrent optimizing compile (TurboFan, Maglev) running meanwhile may
// need a GC to allocate. It asks the main thread for one by posting a task,
// then waits for it: the main thread is waiting for that worker to finish
// before it runs any posted task, and neither moves again. The process sleeps
// at 0% CPU forever. It is nodejs/node#54918, still open; on Node 22.12 it hung
// `faust2wasm.js -poly` intermittently, more often under load.
//
// A referenced timer is a live handle: uv_run then keeps polling instead of
// returning, and the GC request reaches the main thread through the loop's
// async wakeup like any other posted task. The timer never fires; it is
// cleared once the work settles, so it does not keep the process alive.
// (The loop still drains once when the process exits, which no script can
// avoid; the hang was only ever seen in the middle of compiling.)

import { setInterval, clearInterval } from 'timers';

// The longest delay a Node timer accepts without being reset to 1 ms.
const MAX_TIMER_DELAY = 0x7fffffff;

/**
 * Wrap an async function so that the event loop holds a live handle until the
 * promise it returns settles.
 *
 * @template {unknown[]} A
 * @template R
 * @param {(...args: A) => Promise<R>} fn
 * @returns {(...args: A) => Promise<R>}
 */
export const holdEventLoop =
    (fn) =>
    async (...args) => {
        const handle = setInterval(() => {}, MAX_TIMER_DELAY);
        try {
            return await fn(...args);
        } finally {
            clearInterval(handle);
        }
    };
