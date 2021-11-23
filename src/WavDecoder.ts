export interface WavDecoderOptions {
    symmetric?: boolean;
    shared?: boolean;
}
interface Format {
    formatId: number;
    float: boolean;
    numberOfChannels: number;
    sampleRate: number;
    byteRate: number;
    blockSize: number;
    bitDepth: number;
}

/**
 * Code from https://github.com/mohayonao/wav-decoder
 */
class WavDecoder {
    static decode(buffer: ArrayBuffer, options?: WavDecoderOptions) {
        const dataView = new DataView(buffer);
        const reader = new Reader(dataView);
        if (reader.string(4) !== "RIFF") {
            throw new TypeError("Invalid WAV file");
        }
        reader.uint32(); // skip file length
        if (reader.string(4) !== "WAVE") {
            throw new TypeError("Invalid WAV file");
        }
        let format: Format | null = null;
        let audioData: {
            numberOfChannels: number;
            length: number;
            sampleRate: number;
            channelData: Float32Array[];
        } | null = null;
        do {
            const chunkType = reader.string(4);
            const chunkSize = reader.uint32();
            if (chunkType === "fmt ") {
                format = this.decodeFormat(reader, chunkSize);
            } else if (chunkType === "data") {
                audioData = this.decodeData(reader, chunkSize, format as Format, options || {});
            } else {
                reader.skip(chunkSize);
            }
        } while (audioData === null);
        return audioData;
    }
    private static decodeFormat(reader: Reader, chunkSize: number) {
        const formats = {
            0x0001: "lpcm",
            0x0003: "lpcm"
        };
        const formatId = reader.uint16();
        if (!formats.hasOwnProperty(formatId)) {
            throw new TypeError("Unsupported format in WAV file: 0x" + formatId.toString(16));
        }
        const format: Format = {
            formatId: formatId,
            float: formatId === 0x0003,
            numberOfChannels: reader.uint16(),
            sampleRate: reader.uint32(),
            byteRate: reader.uint32(),
            blockSize: reader.uint16(),
            bitDepth: reader.uint16()
        };
        reader.skip(chunkSize - 16);
        return format;
    }
    private static decodeData(reader: Reader, chunkSizeIn: number, format: Format, options: WavDecoderOptions) {
        const chunkSize = Math.min(chunkSizeIn, reader.remain());
        const length = Math.floor(chunkSize / format.blockSize);
        const numberOfChannels = format.numberOfChannels;
        const sampleRate = format.sampleRate;
        const channelData: Float32Array[] = new Array(numberOfChannels);
        for (let ch = 0; ch < numberOfChannels; ch++) {
            const AB = options.shared ? (globalThis.SharedArrayBuffer || globalThis.ArrayBuffer) : globalThis.ArrayBuffer;
            const ab = new AB(length * Float32Array.BYTES_PER_ELEMENT);
            channelData[ch] = new Float32Array(ab);
        }
        this.readPCM(reader, channelData, length, format, options);
        return {
            numberOfChannels,
            length,
            sampleRate,
            channelData
        };
    }
    private static readPCM(reader: Reader, channelData: Float32Array[], length: number, format: Format, options: WavDecoderOptions) {
        const bitDepth = format.bitDepth;
        const decoderOption = format.float ? "f" : options.symmetric ? "s" : "";
        const methodName = "pcm" + bitDepth + decoderOption as `pcm${8 | 16 | 32}${"f" | "s" | ""}`;
        if (!(reader as any)[methodName]) {
            throw new TypeError("Not supported bit depth: " + format.bitDepth);
        }
        const read: () => number = (reader as any)[methodName].bind(reader);
        const numberOfChannels = format.numberOfChannels;
        for (let i = 0; i < length; i++) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
                channelData[ch][i] = read();
            }
        }
    }
}

class Reader {
    pos = 0;
    dataView: DataView;
    constructor(dataView: DataView) {
        this.dataView = dataView;
    }
    remain() {
        return this.dataView.byteLength - this.pos;
    }
    skip(n: number) {
        this.pos += n;
    }
    uint8() {
        const data = this.dataView.getUint8(this.pos);
        this.pos += 1;
        return data;
    }
    int16() {
        const data = this.dataView.getInt16(this.pos, true);
        this.pos += 2;
        return data;
    }
    uint16() {
        const data = this.dataView.getUint16(this.pos, true);
        this.pos += 2;
        return data;
    }
    uint32() {
        const data = this.dataView.getUint32(this.pos, true);
        this.pos += 4;
        return data;
    }
    string(n: number) {
        let data = "";
        for (let i = 0; i < n; i++) {
            data += String.fromCharCode(this.uint8());
        }
        return data;
    }
    pcm8() {
        const data = this.dataView.getUint8(this.pos) - 128;
        this.pos += 1;
        return data < 0 ? data / 128 : data / 127;
    }
    pcm8s() {
        const data = this.dataView.getUint8(this.pos) - 127.5;
        this.pos += 1;
        return data / 127.5;
    }
    pcm16() {
        const data = this.dataView.getInt16(this.pos, true);
        this.pos += 2;
        return data < 0 ? data / 32768 : data / 32767;
    }
    pcm16s() {
        const data = this.dataView.getInt16(this.pos, true);
        this.pos += 2;
        return data / 32768;
    }
    pcm24() {
        const x0 = this.dataView.getUint8(this.pos + 0);
        const x1 = this.dataView.getUint8(this.pos + 1);
        const x2 = this.dataView.getUint8(this.pos + 2);
        const xx = (x0 + (x1 << 8) + (x2 << 16));

        const data = xx > 0x800000 ? xx - 0x1000000 : xx;
        this.pos += 3;
        return data < 0 ? data / 8388608 : data / 8388607;
    }
    pcm24s() {
        const x0 = this.dataView.getUint8(this.pos + 0);
        const x1 = this.dataView.getUint8(this.pos + 1);
        const x2 = this.dataView.getUint8(this.pos + 2);
        const xx = (x0 + (x1 << 8) + (x2 << 16));

        const data = xx > 0x800000 ? xx - 0x1000000 : xx;
        this.pos += 3;
        return data / 8388608;
    }
    pcm32() {
        const data = this.dataView.getInt32(this.pos, true);
        this.pos += 4;
        return data < 0 ? data / 2147483648 : data / 2147483647;
    }
    pcm32s() {
        const data = this.dataView.getInt32(this.pos, true);
        this.pos += 4;
        return data / 2147483648;
    }
    pcm32f() {
        const data = this.dataView.getFloat32(this.pos, true);
        this.pos += 4;
        return data;
    }
    pcm64f() {
        const data = this.dataView.getFloat64(this.pos, true);
        this.pos += 8;
        return data;
    }
}

export default WavDecoder;
