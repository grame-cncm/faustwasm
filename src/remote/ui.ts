import type {
    FaustUIDescriptor,
    FaustUIInputItem,
    FaustUIItem,
    FaustUIOutputItem
} from '../types';

/**
 * What both ends of a remote session need to know about a DSP's controls,
 * read from its JSON alone.
 *
 * This walks the UI tree itself instead of calling
 * `FaustBaseWebAudioDsp.parseUI`: the remote bundle is loaded by a phone that
 * has no compiler and no wasm, and importing the DSP runtime for one tree walk
 * would pull all of it in.
 */
export interface FaustRemoteUI {
    /** Input items, in the order `getParams()` lists them. */
    readonly inputs: FaustUIInputItem[];
    /** Output items (bargraphs), in UI order. */
    readonly outputs: FaustUIOutputItem[];
    /** Short names and labels, to the address they stand for. */
    readonly aliases: Record<string, string>;
    /**
     * Whether a control remote controls may drive carries `[acc:...]`
     * metadata: whether a remote control's accelerometer has anything to do.
     */
    readonly hasAcc: boolean;
    /** The same for `[gyr:...]` and the gyroscope. */
    readonly hasGyr: boolean;
}

const INPUT_TYPES = new Set([
    'vslider',
    'hslider',
    'button',
    'checkbox',
    'nentry'
]);
const OUTPUT_TYPES = new Set(['hbargraph', 'vbargraph']);

/** Read the controls of a UI descriptor. */
export const readUI = (ui: FaustUIDescriptor): FaustRemoteUI => {
    const inputs: FaustUIInputItem[] = [];
    const outputs: FaustUIOutputItem[] = [];
    const aliases: Record<string, string> = {};
    let hasAcc = false;
    let hasGyr = false;
    const visit = (item: FaustUIItem) => {
        if ('items' in item) {
            item.items.forEach(visit);
        } else if (INPUT_TYPES.has(item.type)) {
            const input = item as FaustUIInputItem;
            inputs.push(input);
            // First come, first kept, as the node does
            for (const alias of [input.shortname, input.label]) {
                if (alias && !(alias in aliases))
                    aliases[alias] = input.address;
            }
            // A control kept from remote controls is not theirs to drive by
            // their sensors either
            if (!isRemoteOff(input)) {
                for (const meta of input.meta ?? []) {
                    if (meta.acc) hasAcc = true;
                    if (meta.gyr) hasGyr = true;
                }
            }
        } else if (OUTPUT_TYPES.has(item.type)) {
            outputs.push(item as FaustUIOutputItem);
        }
    };
    ui.forEach(visit);
    return { inputs, outputs, aliases, hasAcc, hasGyr };
};

/**
 * Whether the DSP keeps a control out of remote controls' reach, by
 * `[remote:off]` in its label: they show it and follow its value, but cannot
 * change it. To hide it as well, `[hidden:1]`, which faust-ui honours.
 */
export const isRemoteOff = (item: FaustUIInputItem) =>
    (item.meta ?? []).some(
        (meta) => (meta.remote ?? '').trim().toLowerCase() === 'off'
    );

/**
 * The range a value written to an input is held to.
 *
 * A button or a checkbox carries no range in the JSON; its values are 0 and 1.
 */
export const inputRange = (item: FaustUIInputItem): [number, number] => {
    if (item.type === 'button' || item.type === 'checkbox') return [0, 1];
    return [item.min ?? -Infinity, item.max ?? Infinity];
};

/** Whether an input is discrete, so that a lost write would be a wrong state. */
export const isDiscrete = (item: FaustUIInputItem) =>
    item.type === 'button' ||
    item.type === 'checkbox' ||
    item.type === 'nentry';
