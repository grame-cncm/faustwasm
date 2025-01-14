
/**
 * Layout:
 * 
 * 
 * invert-isAndroid (uint8)
 * new-acc-data-available (uint8)
 * new-gyr-data-available (uint8)
 * empty (uint8)
 * 
 * acc.x, acc.y, acc.z (f32)
 * 
 * gyr.alpha, gyr.beta, gyr.gamma (f32)
 */
export class FaustAudioWorkletCommunicator {
    protected readonly port: MessagePort;
    protected readonly supportSharedArrayBuffer: boolean;
    protected readonly byteLength: number;
    protected uin8Invert: Uint8ClampedArray;
    protected uin8NewAccData: Uint8ClampedArray;
    protected uin8NewGyrData: Uint8ClampedArray;
    protected f32Acc: Float32Array;
    protected f32Gyr: Float32Array;
    constructor(port: MessagePort) {
        this.port = port;
        this.supportSharedArrayBuffer = !!globalThis.SharedArrayBuffer;
        this.byteLength
            = 4 * Uint8Array.BYTES_PER_ELEMENT
            + 3 * Float32Array.BYTES_PER_ELEMENT
            + 3 * Float32Array.BYTES_PER_ELEMENT;
    }
    initializeBuffer(ab: SharedArrayBuffer | ArrayBuffer) {
        let ptr = 0;
        this.uin8Invert = new Uint8ClampedArray(ab, ptr, 1);
        ptr += Uint8ClampedArray.BYTES_PER_ELEMENT;
        this.uin8NewAccData = new Uint8ClampedArray(ab, ptr, 1);
        ptr += Uint8ClampedArray.BYTES_PER_ELEMENT;
        this.uin8NewGyrData = new Uint8ClampedArray(ab, ptr, 1);
        ptr += Uint8ClampedArray.BYTES_PER_ELEMENT;
        ptr += Uint8ClampedArray.BYTES_PER_ELEMENT;; // empty
        this.f32Acc = new Float32Array(ab, ptr, 3);
        ptr += 3 * Float32Array.BYTES_PER_ELEMENT;
        this.f32Gyr = new Float32Array(ab, ptr, 3);
        ptr += 3 * Float32Array.BYTES_PER_ELEMENT;
    }
    setNewAccDataAvailable(value: boolean) {
        if (!this.uin8NewAccData) return;
        this.uin8NewAccData[0] = +value;
    }
    getNewAccDataAvailable() {
        return !!this.uin8NewAccData?.[0];
    }
    setNewGyrDataAvailable(value: boolean) {
        if (!this.uin8NewGyrData) return;
        this.uin8NewGyrData[0] = +value;
    }
    getNewGyrDataAvailable() {
        return !!this.uin8NewGyrData?.[0];
    }
    setAcc({ x, y, z }: { x: number, y: number, z: number }, invert = false) {
        if (!this.supportSharedArrayBuffer) {
            const e = { type: "acc", data: { x, y, z }, invert };
            this.port.postMessage(e);
        }
        if (!this.uin8NewAccData) return;
        this.uin8Invert[0] = +invert;
        this.f32Acc[0] = x;
        this.f32Acc[1] = y;
        this.f32Acc[2] = z;
        this.uin8NewAccData[0] = 1;
    }
    getAcc() {
        if (!this.uin8NewAccData) return;
        const invert = !!this.uin8Invert[0];
        const [x, y, z] = this.f32Acc;
        return { x, y, z, invert };
    }
    setGyr({ alpha, beta, gamma }: { alpha: number, beta: number, gamma: number }) {
        if (!this.supportSharedArrayBuffer) {
            const e = { type: "gyr", data: { alpha, beta, gamma } };
            this.port.postMessage(e);
        }
        if (!this.uin8NewGyrData) return;
        this.f32Gyr[0] = alpha;
        this.f32Gyr[1] = beta;
        this.f32Gyr[2] = gamma;
        this.uin8NewGyrData[0] = 1;
    }
    getGyr() {
        if (!this.uin8NewGyrData) return;
        const [alpha, beta, gamma] = this.f32Gyr;
        return { alpha, beta, gamma };
    }
}

export class FaustAudioWorkletNodeCommunicator extends FaustAudioWorkletCommunicator {
    constructor(port: MessagePort) {
        super(port);
        if (this.supportSharedArrayBuffer) {
            const sab = new SharedArrayBuffer(this.byteLength);
            this.initializeBuffer(sab);
            this.port.postMessage({ type: "initSab", sab });
        } else {
            const ab = new ArrayBuffer(this.byteLength);
            this.initializeBuffer(ab);
        }
    }
}

export class FaustAudioWorkletProcessorCommunicator extends FaustAudioWorkletCommunicator {
    constructor(port: MessagePort) {
        super(port);
        
        if (this.supportSharedArrayBuffer) {
            this.port.addEventListener("message", (event) => {
                const { data } = event;
                if (data.type === "initSab") {
                    this.initializeBuffer(data.sab);
                }
            });
        } else {
            const ab = new ArrayBuffer(this.byteLength);
            this.initializeBuffer(ab);
            this.port.addEventListener("message", (event) => {
                const msg = event.data;
    
                switch (msg.type) {
                    // Sensors messages
                    case "acc": {
                        this.setAcc(msg.data, msg.invert);
                        break;
                    }
                    case "gyr": {
                        this.setGyr(msg.data);
                        break;
                    }
                    default:
                        break;
                }
            });
        }
    }
}
