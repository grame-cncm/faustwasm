/**
 * What the host side needs from its JavaScript environment, with a fallback
 * for each piece an environment may lack.
 *
 * Browsers and Node (19 and later) have everything, and nothing changes for
 * them. Max's `v8` object has timers, `TextEncoder` and networking, but does
 * not document `EventTarget`, `CustomEvent`, `performance` or `crypto`: the
 * host must still load and run there (section 20 of
 * `docs/remote-control.md`). Nothing here is evaluated when the module loads
 * except the choice of the event base class.
 */

/** Milliseconds, monotonic where the environment allows it. */
export const now = (): number => globalThis.performance?.now?.() ?? Date.now();

type Listener = ((event: Event) => void) | { handleEvent(event: Event): void };

/**
 * Just enough of `EventTarget` for the host's `join`, `leave` and `error`
 * events: add, remove, dispatch, listeners called in the order added.
 */
class MinimalEventTarget {
    readonly #listeners = new Map<string, Listener[]>();

    addEventListener(type: string, listener: Listener | null) {
        if (!listener) return;
        const list = this.#listeners.get(type) ?? [];
        if (!list.includes(listener)) list.push(listener);
        this.#listeners.set(type, list);
    }

    removeEventListener(type: string, listener: Listener | null) {
        const list = this.#listeners.get(type);
        if (!list || !listener) return;
        const index = list.indexOf(listener);
        if (index !== -1) list.splice(index, 1);
    }

    dispatchEvent(event: Event) {
        for (const listener of [...(this.#listeners.get(event.type) ?? [])]) {
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
        }
        return true;
    }
}

/** The environment's `EventTarget`, or the minimal one. */
export const EventTargetBase: typeof EventTarget =
    globalThis.EventTarget ??
    (MinimalEventTarget as unknown as typeof EventTarget);

/**
 * An event carrying `detail`: a `CustomEvent` where there is one, otherwise
 * a plain object with the same `type` and `detail`, which is all the host's
 * listeners read.
 */
export const customEvent = <T>(type: string, detail: T): CustomEvent<T> =>
    typeof globalThis.CustomEvent === 'function'
        ? new CustomEvent(type, { detail })
        : ({ type, detail } as unknown as CustomEvent<T>);

/**
 * Bytes from the environment's secure random source. Throws where there is
 * none: what this feeds (pairing tokens, identifiers a remote control must
 * not guess) has no safe fallback.
 */
export const secureRandomBytes = (count: number): Uint8Array => {
    const crypto = globalThis.crypto;
    if (!crypto?.getRandomValues)
        throw new Error(
            'no secure random source here (crypto.getRandomValues): give the token yourself'
        );
    return crypto.getRandomValues(new Uint8Array(count));
};

/**
 * An identifier that only has to differ from the others, not to be secret
 * (the host's session id): from the secure source where there is one.
 */
export const uniqueId = (bytes = 8): string => {
    const values = globalThis.crypto?.getRandomValues
        ? globalThis.crypto.getRandomValues(new Uint8Array(bytes))
        : Uint8Array.from({ length: bytes }, () =>
              Math.floor(Math.random() * 256)
          );
    return Array.from(values, (b) => b.toString(16).padStart(2, '0')).join('');
};

// ---------------------------------------------------------------- SHA-256

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/**
 * SHA-256 (FIPS 180-4) in plain JavaScript, for environments without
 * `crypto.subtle`. Only hashes the DSP's JSON, so speed hardly matters.
 */
export const sha256 = (data: Uint8Array): Uint8Array => {
    const bitLength = data.length * 8;
    const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    // The length in bits, big-endian, in the last 8 bytes
    view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
    view.setUint32(padded.length - 4, bitLength >>> 0);
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
        0x1f83d9ab, 0x5be0cd19
    ]);
    const w = new Uint32Array(64);
    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + 4 * t);
        for (let t = 16; t < 64; t++) {
            const s0 =
                rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 =
                rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) >>> 0;
        }
        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
        h[5] += f;
        h[6] += g;
        h[7] += hh;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    h.forEach((word, i) => outView.setUint32(4 * i, word));
    return out;
};
