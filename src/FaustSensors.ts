
interface Window {
    DeviceMotionEvent: DeviceMotionEvent
}

export interface AccParams {
    isEnabled: boolean;
    acc: string;
    address: string;
    min: number;
    max: number;
    init: number;
    label: string;
}

// Enum describing the axis of the accelerometer or gyroscope
export enum Axis { x, y, z };

/**
 * Function to convert a number to an axis type
 * 
 * @param value : number
 * @returns : axis type
 */
export function convertToAxis(value: number): Axis {
    switch (value) {
        case 0:
            return Axis.x;
        case 1:
            return Axis.y;
        case 2:
            return Axis.z;
        default:
            console.error("Error: Axis not found value: " + value);
            return Axis.x;
    }
}

// Enum describing the curve of the accelerometer
export enum Curve { Up, Down, UpDown, DownUp };

/**
 * Function to convert a number to a curve type
 * 
 * @param value : number
 * @returns : curve type
 */
export function convertToCurve(value: number): Curve {
    switch (value) {
        case 0:
            return Curve.Up;
        case 1:
            return Curve.Down;
        case 2:
            return Curve.UpDown;
        case 3:
            return Curve.DownUp;
        default:
            console.error("Error: Curve not found value: " + value);
            return Curve.Up;
    }
}

// Object describing value off accelerometer metadata values
class AccMeta {
    axis: Axis;
    curve: Curve;
    amin: number;
    amid: number;
    amax: number
}

/***************************************************************************************
********************  Converter objects use to map acc and Faust value *****************
****************************************************************************************/

class Range {
    fLo: number;
    fHi: number;

    constructor(x: number, y: number) {
        this.fLo = Math.min(x, y);
        this.fHi = Math.max(x, y);
    }

    clip(x: number): number {
        if (x < this.fLo) {
            return this.fLo
        } else if (x > this.fHi) {
            return this.fHi
        } else {
            return x;
        }
    }
}

interface InterpolateObject {
    amin: number;
    amax: number;
}

/**
 * Interpolator class
 */
class Interpolator {
    fRange: Range;
    fCoef: number;
    fOffset: number;

    constructor(lo: number, hi: number, v1: number, v2: number) {
        this.fRange = new Range(lo, hi);
        if (hi != lo) {
            // regular case
            this.fCoef = (v2 - v1) / (hi - lo);
            this.fOffset = v1 - lo * this.fCoef;
        } else {
            // degenerate case, avoids division by zero
            this.fCoef = 0;
            this.fOffset = (v1 + v2) / 2;
        }
    }
    returnMappedValue(v: number): number {
        var x = this.fRange.clip(v);
        return this.fOffset + x * this.fCoef
    }
    getLowHigh(amin: number, amax: number): InterpolateObject {
        return { amin: this.fRange.fLo, amax: this.fRange.fHi }
    }
}

interface InterpolateObject3pt {
    amin: number;
    amid: number;
    amax: number;
}

/**
 * Interpolator3pt class, combine two interpolators
 */
class Interpolator3pt {
    fSegment1: Interpolator;
    fSegment2: Interpolator;
    fMid: number;

    constructor(lo: number, mid: number, hi: number, v1: number, vMid: number, v2: number) {
        this.fSegment1 = new Interpolator(lo, mid, v1, vMid);
        this.fSegment2 = new Interpolator(mid, hi, vMid, v2);
        this.fMid = mid;
    }
    returnMappedValue(x: number): number {
        return (x < this.fMid) ? this.fSegment1.returnMappedValue(x) : this.fSegment2.returnMappedValue(x)
    }

    getMappingValues(amin: number, amid: number, amax: number): InterpolateObject3pt {
        var lowHighSegment1 = this.fSegment1.getLowHigh(amin, amid);
        var lowHighSegment2 = this.fSegment2.getLowHigh(amid, amax);
        return { amin: lowHighSegment1.amin, amid: lowHighSegment2.amin, amax: lowHighSegment2.amax }
    }
}

/**
 * ValueConverter interface
 */
interface ValueConverter {
    uiToFaust: (x: number) => number;
    faustToUi: (x: number) => number;
}

/**
 * UpdatableValueConverter interface
 */

export interface UpdatableValueConverter extends ValueConverter {
    fActive: boolean;

    setMappingValues: (amin: number, amid: number, amax: number, min: number, init: number, max: number) => void;
    getMappingValues: (amin: number, amid: number, amax: number) => InterpolateObject3pt;

    setActive: (onOff: boolean) => void;
    getActive: () => boolean;
}

/**
 * UpConverter class, convert accelerometer value to Faust value
 */
export class UpConverter implements UpdatableValueConverter {
    fA2F: Interpolator3pt;
    fF2A: Interpolator3pt;
    fActive: boolean = true;

    constructor(amin: number, amid: number, amax: number, fmin: number, fmid: number, fmax: number) {
        this.fA2F = new Interpolator3pt(amin, amid, amax, fmin, fmid, fmax);
        this.fF2A = new Interpolator3pt(fmin, fmid, fmax, amin, amid, amax);
    }

    uiToFaust(x: number) { return this.fA2F.returnMappedValue(x) }
    faustToUi(x: number) { return this.fF2A.returnMappedValue(x) };

    setMappingValues(amin: number, amid: number, amax: number, min: number, init: number, max: number): void {
        this.fA2F = new Interpolator3pt(amin, amid, amax, min, init, max);
        this.fF2A = new Interpolator3pt(min, init, max, amin, amid, amax);
    };

    getMappingValues(amin: number, amid: number, amax: number): InterpolateObject3pt {
        return this.fA2F.getMappingValues(amin, amid, amax);
    };

    setActive(onOff: boolean): void { this.fActive = onOff };
    getActive(): boolean { return this.fActive };
}

/**
 * DownConverter class, convert accelerometer value to Faust value
 */
export class DownConverter implements UpdatableValueConverter {
    fA2F: Interpolator3pt;
    fF2A: Interpolator3pt;
    fActive: boolean = true;

    constructor(amin: number, amid: number, amax: number, fmin: number, fmid: number, fmax: number) {
        this.fA2F = new Interpolator3pt(amin, amid, amax, fmax, fmid, fmin);
        this.fF2A = new Interpolator3pt(fmin, fmid, fmax, amax, amid, amin);
    }

    uiToFaust(x: number) { return this.fA2F.returnMappedValue(x) }
    faustToUi(x: number) { return this.fF2A.returnMappedValue(x) };

    setMappingValues(amin: number, amid: number, amax: number, min: number, init: number, max: number): void {
        this.fA2F = new Interpolator3pt(amin, amid, amax, max, init, min);
        this.fF2A = new Interpolator3pt(min, init, max, amax, amid, amin);
    };
    getMappingValues(amin: number, amid: number, amax: number): InterpolateObject3pt {
        return this.fA2F.getMappingValues(amin, amid, amax);
    };

    setActive(onOff: boolean): void { this.fActive = onOff };
    getActive(): boolean { return this.fActive };
}

/**
 * UpDownConverter class, convert accelerometer value to Faust value
 */
export class UpDownConverter implements UpdatableValueConverter {
    fA2F: Interpolator3pt;
    fF2A: Interpolator;
    fActive: boolean = true;

    constructor(amin: number, amid: number, amax: number, fmin: number, fmid: number, fmax: number) {
        this.fA2F = new Interpolator3pt(amin, amid, amax, fmin, fmax, fmin);
        this.fF2A = new Interpolator(fmin, fmax, amin, amax);
    }

    uiToFaust(x: number) { return this.fA2F.returnMappedValue(x) }
    faustToUi(x: number) { return this.fF2A.returnMappedValue(x) };

    setMappingValues(amin: number, amid: number, amax: number, min: number, init: number, max: number): void {
        this.fA2F = new Interpolator3pt(amin, amid, amax, min, max, min);
        this.fF2A = new Interpolator(min, max, amin, amax);
    };
    getMappingValues(amin: number, amid: number, amax: number): InterpolateObject3pt {
        return this.fA2F.getMappingValues(amin, amid, amax);
    };

    setActive(onOff: boolean): void { this.fActive = onOff };
    getActive(): boolean { return this.fActive };
}

/**
 * DownUpConverter class, convert accelerometer value to Faust value
 */
export class DownUpConverter implements UpdatableValueConverter {
    fA2F: Interpolator3pt;
    fF2A: Interpolator;
    fActive: boolean = true;

    constructor(amin: number, amid: number, amax: number, fmin: number, fmid: number, fmax: number) {
        this.fA2F = new Interpolator3pt(amin, amid, amax, fmax, fmin, fmax);
        this.fF2A = new Interpolator(fmin, fmax, amin, amax);
    }

    uiToFaust(x: number) { return this.fA2F.returnMappedValue(x) }
    faustToUi(x: number) { return this.fF2A.returnMappedValue(x) };

    setMappingValues(amin: number, amid: number, amax: number, min: number, init: number, max: number): void {
        this.fA2F = new Interpolator3pt(amin, amid, amax, max, min, max);
        this.fF2A = new Interpolator(min, max, amin, amax);
    };
    getMappingValues(amin: number, amid: number, amax: number): InterpolateObject3pt {
        return this.fA2F.getMappingValues(amin, amid, amax);
    };

    setActive(onOff: boolean): void { this.fActive = onOff };
    getActive(): boolean { return this.fActive };
}

/**
 * Public function to build the accelerometer handler
 *
 * @param curve : Curve type
 * @param amin : number 
 * @param amid : number 
 * @param amax : number 
 * @param min : number 
 * @param init : number 
 * @param max : number 
 * @returns : UpdatableValueConverter built for the given curve
 */
export function buildHandler(curve: Curve, amin: number, amid: number, amax: number, min: number, init: number, max: number): UpdatableValueConverter {
    switch (curve) {
        case Curve.Up:
            return new UpConverter(amin, amid, amax, min, init, max);
        case Curve.Down:
            return new DownConverter(amin, amid, amax, min, init, max);
        case Curve.UpDown:
            return new UpDownConverter(amin, amid, amax, min, init, max);
        case Curve.DownUp:
            return new DownUpConverter(amin, amid, amax, min, init, max);
        default:
            return new UpConverter(amin, amid, amax, min, init, max);
    }
}