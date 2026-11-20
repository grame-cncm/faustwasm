/**
 * What a Max patch and its phones say to each other, whatever runs the
 * server: the part of the Max host shared by `assets/max/faust-remote.js`
 * (the `node.script`, which loads it from `dist/remote/max-bridge.js`) and
 * `assets/max/faust-remote-v8.js` (the `v8` object, which bundles it).
 * Each script brings what differs between the two -- the server, reading
 * files, the session, the console -- and hands the rest to this bridge.
 *
 * Inside, the patch's DSP is stood in for by a `FaustRemoteHub`: a host
 * target built from the DSP's JSON, which holds the values and looks, to a
 * `FaustRemoteHost`, like a Faust node. The host takes the phones through
 * the room's relay port, exactly as a Web Audio page would, and the hub
 * turns what they write into messages for the patch:
 *
 *     phone --relay--> host --> hub --onwrite--> outlet: param / pset
 *     patch: values / pvalues --> report() --> hub.update / hub.output --> host --> phones
 *
 * Messages, in both scripts (see their headers):
 *
 * - in: `json <text>`, `values <path> <v> ...` (faustgen~),
 *   `pvalues <name> <v> ...` (named parameters, `target params`);
 * - out: `param <path> <v>`, `pset <name> <v>`, `midi <bytes...>`, `dump`,
 *   `getjson`, `link <url>`, `clients <n>`.
 *
 * Two targets, the same flow (docs/remote-control.md, 20.2): a faustgen~ is
 * addressed by its controls' paths (`param`, `values`), and only says what
 * its controls are worth when asked (`dump`); named parameters are
 * addressed by the labels of the JSON (`pset`, `pvalues`), and report their
 * own moves through faust-params.js.
 *
 * Internal to the two scripts: not part of the package's API.
 */
import {
    FaustRemoteHost,
    type FaustRemoteHostOptions
} from '../remote/FaustRemoteHost';
import { FaustRemoteHub } from '../remote/hub';
import type { FaustRelayPort } from '../remote/relay';

/**
 * How often faustgen~ is asked for its controls (ms), while phones are
 * connected: the delay before a change made in the patch reaches them.
 * Each `dump` costs faustgen~ one list per control, so not faster.
 */
export const DUMP_PERIOD = 250;

export interface MaxBridgeOptions {
    /** Send a message out of the object's (first) outlet. */
    outlet: (...message: (string | number)[]) => void;
    /** A line for the Max console. */
    post: (message: string) => void;
    /** An error line for the Max console. */
    error: (message: string) => void;
    /**
     * The room's relay, as a port for a host in this process: called once
     * per DSP, since each new DSP gets a new host (and the old port is
     * closed first, which ends the phones' connections to the old one).
     */
    hostRoom: () => FaustRelayPort;
    /** The pairing link, sent out each time a DSP is ready. */
    link: string;
    /** `target params`: named parameters rather than a faustgen~. */
    params?: boolean;
    /**
     * The phones' interface, from a Faust JSON (the text of a
     * `dsp-meta.json`) rather than from the patch: the `json` messages are
     * then ignored.
     */
    ui?: string;
    /** Passed to the host as is: token, sensor policy, groups, timed mode. */
    hostOptions?: FaustRemoteHostOptions;
    /**
     * How often to ask faustgen~ for `dump` while phones are connected (ms),
     * `DUMP_PERIOD` by default; 0 never asks, for a faustgen~ that reports
     * its changes itself (`@report`).
     */
    dumpPeriod?: number;
}

/**
 * Each control's label and address, both ways, from a Faust UI tree: named
 * parameters are matched to the JSON's controls by label, so two controls
 * with the same label cannot both be driven (the first one wins, and the
 * console says so).
 */
export const labels = (ui: any[], error: (message: string) => void) => {
    const byLabel = new Map<string, string>();
    const byAddress = new Map<string, string>();
    const walk = (items: any[] | undefined) => {
        for (const item of items ?? []) {
            if (item.items) walk(item.items);
            else if (item.address && item.label !== undefined) {
                if (byLabel.has(item.label))
                    error(
                        `faust-remote: two controls are labelled "${item.label}"; the first one is kept`
                    );
                else byLabel.set(item.label, item.address);
                byAddress.set(item.address, item.label);
            }
        }
    };
    walk(ui);
    return { byLabel, byAddress };
};

/** Everything that belongs to one DSP, replaced as a whole when it changes. */
interface Current {
    /** The JSON it was built from: the same text again changes nothing. */
    json: string;
    hub: FaustRemoteHub;
    host: FaustRemoteHost;
    port: FaustRelayPort;
    names: ReturnType<typeof labels>;
    /** The input controls' addresses; anything else reported is a bargraph. */
    inputs: Set<string>;
}

/**
 * The bridge between a patch and its phones. Call `start` once the object
 * can send messages; route the patch's `json`, `values` and `pvalues`
 * messages to the methods of the same names; `close` when the object goes.
 */
export const createMaxBridge = (options: MaxBridgeOptions) => {
    const { outlet, post, error, link, params = false } = options;
    const dumpPeriod = options.dumpPeriod ?? DUMP_PERIOD;
    let current: Current | null = null;
    /** Asks faustgen~ for `dump` while phones are connected. */
    let dumpTimer: ReturnType<typeof setInterval> | null = null;
    /** Asks the patch for its JSON until it has given one. */
    let ask: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    /** Phones came or went: tell the patch, and dump only for an audience. */
    const clientsChanged = () => {
        const count = current?.host.clients.length ?? 0;
        outlet('clients', count);
        // faustgen~ says nothing of its controls unless asked (or unless it
        // has `@report`); parameters report their own changes
        if (params || dumpPeriod <= 0) return;
        if (count > 0 && !dumpTimer)
            dumpTimer = setInterval(() => outlet('dump'), dumpPeriod);
        if (count === 0 && dumpTimer) {
            clearInterval(dumpTimer);
            dumpTimer = null;
        }
    };

    /** End the current DSP's host: its phones are disconnected. */
    const stop = () => {
        if (!current) return;
        current.host.close();
        current.port.close();
        current.hub.close();
        current = null;
    };

    /**
     * A new DSP (or the first): a new hub and host; phones reconnect. A
     * faustgen~ sends its JSON again each time it compiles, and the patch
     * may answer `getjson` more than once: an identical text is ignored, so
     * that only a DSP that really changed costs the phones their connection.
     * (Telling connected phones that the DSP changed, without a reconnect,
     * needs a protocol message: step 6 of 20.8.)
     */
    const setDSP = (json: string) => {
        if (closed || json === current?.json) return;
        let hub: FaustRemoteHub;
        let names: ReturnType<typeof labels>;
        try {
            hub = new FaustRemoteHub(json, {
                // What a phone wrote (sensors included, already mapped by
                // the DSP's curves), as a message for the patch. `names` is
                // set just below, before any phone can write.
                onwrite: (address, value) =>
                    params
                        ? outlet(
                              'pset',
                              names.byAddress.get(address) ?? address,
                              value
                          )
                        : outlet('param', address, value),
                onmidi: (data) => outlet('midi', ...data)
            });
            names = labels(hub.getMeta().ui, error);
        } catch (e) {
            // A broken JSON leaves the current DSP as it was
            error(`faust-remote: not a Faust JSON (${(e as Error).message})`);
            return;
        }
        stop();
        const host = new FaustRemoteHost(hub, options.hostOptions);
        host.addEventListener('join', (event: any) => {
            const { id, group } = event.detail;
            post(
                `faust-remote: phone ${id} joined${group ? ` (${group})` : ''}`
            );
            clientsChanged();
        });
        host.addEventListener('leave', (event: any) => {
            post(`faust-remote: phone ${event.detail.id} left`);
            clientsChanged();
        });
        host.addEventListener('error', (event: any) =>
            error(`faust-remote: ${event.detail?.message ?? event.detail}`)
        );
        const port = options.hostRoom();
        host.acceptRelay(port);
        current = {
            json,
            hub,
            host,
            port,
            names,
            inputs: new Set(hub.getParams())
        };
        clientsChanged();
        post(
            `faust-remote: ${hub.getMeta().name ?? 'DSP'} ready, remote control: ${link}`
        );
        outlet('link', link);
    };

    /** A value reported by the patch: a control that moved, or a bargraph. */
    const report = (address: string, value: number) => {
        if (!current || !Number.isFinite(value)) return;
        if (current.inputs.has(address)) {
            // What a phone wrote comes back the same (a dump reports every
            // control): only a change made in the patch goes to the phones.
            // `update`, not `setParamValue`: the value comes from the patch,
            // so it must not go back to it through `onwrite`.
            if (value !== current.hub.getParamValue(address))
                current.hub.update(address, value);
        } else {
            current.hub.output(address, value);
        }
    };

    return {
        /** The current DSP's host, if any. */
        get host() {
            return current?.host ?? null;
        },
        /**
         * Begin: with `ui`, that interface (and, for parameters, ask the
         * patch for their current values, which come with its JSON);
         * otherwise ask the patch for its JSON until it gives one -- the
         * JSON faustgen~ sent when it compiled may well have come before
         * this object was ready to hear it.
         */
        start() {
            if (options.ui !== undefined) {
                setDSP(options.ui);
                // Parameters report only their changes: their current
                // values are asked for once, through the JSON
                // faust-params.js builds
                if (params) outlet('getjson');
                return;
            }
            ask = setInterval(() => {
                if (current && ask) {
                    clearInterval(ask);
                    ask = null;
                } else outlet('getjson');
            }, 1000);
            outlet('getjson');
        },
        /** `json <text>`: the patch's DSP, unless `ui` gave the interface. */
        json(text: string) {
            if (options.ui === undefined) setDSP(text);
        },
        /**
         * `values <path> <v> ...`: what faustgen~ reports, by path: its
         * controls after a `dump`, its bargraphs (thinned by faust-json.js).
         */
        values(...pairs: unknown[]) {
            for (let i = 0; i + 1 < pairs.length; i += 2)
                report(String(pairs[i]), Number(pairs[i + 1]));
        },
        /**
         * A list from faustgen~'s control outlet, `<path> <cur> <min> <max>`
         * (after a `dump`, from `@report`, or a bargraph at every block),
         * when it is wired to the script without faust-json.js.
         */
        list(...atoms: unknown[]) {
            if (atoms.length >= 2) report(String(atoms[0]), Number(atoms[1]));
        },
        /**
         * `pvalues <name> <v> ...`: named parameters that moved, and
         * bargraphs, by label; names the JSON does not have are ignored.
         */
        pvalues(...pairs: unknown[]) {
            if (!current) return;
            for (let i = 0; i + 1 < pairs.length; i += 2) {
                const address = current.names.byLabel.get(String(pairs[i]));
                if (address) report(address, Number(pairs[i + 1]));
            }
        },
        /** Stop for good: the host, its port, the timers. */
        close() {
            closed = true;
            if (ask) clearInterval(ask);
            if (dumpTimer) clearInterval(dumpTimer);
            ask = dumpTimer = null;
            stop();
        }
    };
};

export type MaxBridge = ReturnType<typeof createMaxBridge>;
