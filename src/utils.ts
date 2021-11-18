export const midiToFreq = (note: number) => 440.0 * 2 ** ((note - 69) / 12);
export const remap = (v: number, mn0: number, mx0: number, mn1: number, mx1: number) => (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;
export const findPath = (o: any, p: string) => {
    if (typeof o !== "object") return false;
    if (o.address) {
        return (o.address === p);
    }
    for (const k in o) {
        if (findPath(o[k], p)) return true;
    }
    return false;
};
