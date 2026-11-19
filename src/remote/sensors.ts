import FaustSensors, { Axis } from '../FaustSensors';
import type {
    FaustUIDescriptor,
    FaustUIInputItem,
    FaustUIItem
} from '../types';
import { isRemoteOff } from './ui';

/**
 * Sensor mappings and groups, as the remote layer applies them itself: the
 * host for its `assigned` sensor policy, a remote control playing the DSP
 * locally for its own gestures.
 *
 * The curves are those of `FaustSensors`, the package's own, so that a value
 * mapped here is the value the node's mapping would give. `FaustSensors`
 * stays internal: it is bundled where it is used, never exported.
 */

/** A control a sensor axis drives, with the DSP's curve for it. */
export interface SensorTarget {
    readonly path: string;
    readonly axis: Axis;
    readonly convert: (value: number) => number;
}

/**
 * The control a sensor axis drives, from its `[acc:...]` or `[gyr:...]`
 * metadata: "axis curve amin amid amax", read as the DSP reads it.
 */
const sensorTarget = (item: FaustUIInputItem, spec: string): SensorTarget => {
    const [axis, curve, amin, amid, amax] = spec.trim().split(' ').map(Number);
    const converter = FaustSensors.buildHandler(
        FaustSensors.convertToCurve(curve),
        amin,
        amid,
        amax,
        item.min ?? 0,
        item.init ?? 0,
        item.max ?? 1
    );
    return {
        path: item.address,
        axis: FaustSensors.convertToAxis(axis),
        convert: (value) => converter.uiToFaust(value)
    };
};

/**
 * The sensor controls remote controls may drive (outside `[remote:off]`), by
 * sensor.
 */
export const sensorTargets = (inputs: FaustUIInputItem[]) => {
    const acc: SensorTarget[] = [];
    const gyr: SensorTarget[] = [];
    for (const item of inputs) {
        if (isRemoteOff(item)) continue;
        for (const meta of item.meta ?? []) {
            if (meta.acc) acc.push(sensorTarget(item, meta.acc));
            if (meta.gyr) gyr.push(sensorTarget(item, meta.gyr));
        }
    }
    return { acc, gyr };
};

/** A top-level group of the DSP, for `assign: 'groups'`. */
export interface Group {
    readonly label: string;
    readonly paths: ReadonlySet<string>;
}

/**
 * The groups directly under the DSP's top group, with the addresses of the
 * controls each holds, however deep: what `assign: 'groups'` hands out.
 */
export const topLevelGroups = (ui: FaustUIDescriptor): Group[] => {
    const paths = (item: FaustUIItem): string[] =>
        'items' in item ? item.items.flatMap(paths) : [item.address];
    return ui.flatMap((root) =>
        root.items
            .filter(
                (item): item is Extract<FaustUIItem, { items: unknown }> =>
                    'items' in item
            )
            .map((group) => ({
                label: group.label,
                paths: new Set(paths(group))
            }))
    );
};
