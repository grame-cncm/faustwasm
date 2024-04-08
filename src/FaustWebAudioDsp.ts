import type { FaustMonoDspInstance, FaustPolyDspInstance, IFaustDspInstance } from "./FaustDspInstance";
import type { FaustDspMeta, FaustUIDescriptor, FaustUIGroup, FaustUIInputItem, FaustUIItem } from "./types";

// Public API
export type OutputParamHandler = (path: string, value: number) => void;
export type ComputeHandler = (buffer_size: number) => void;
export type PlotHandler = (plotted: Float32Array[] | Float64Array[], index: number, events?: { type: string; data: any }[]) => void;
export type MetadataHandler = (key: string, value: string) => void;

// Implementation API
export type UIHandler = (item: FaustUIItem) => void;

/**
 * WasmAllocator is a basic memory management class designed to allocate
 * blocks of memory within a WebAssembly.Memory object. It provides a simple
 * alloc method to allocate a contiguous block of memory of a specified size.
 * 
 * The allocator operates by keeping a linear progression through the memory,
 * always allocating the next block at the end of the last. This approach does not
 * handle freeing of memory or reuse of memory spaces.
 */
class WasmAllocator {
    // The WebAssembly.Memory object this allocator will manage.
    private readonly memory: WebAssembly.Memory;
    // The number of bytes currently allocated. This serves as the "pointer" to the
    // next free byte in the memory.
    private allocatedBytes: number;

    constructor(memory: WebAssembly.Memory, offset: number) {
        this.memory = memory;
        // Initialize the allocator with offset allocated bytes.
        this.allocatedBytes = offset;
    }

    /**
     * Allocates a block of memory of the specified size, returning the pointer to the
     * beginning of the block. The block is allocated at the current offset and the
     * offset is incremented by the size of the block.
     * 
     * @param sizeInBytes The size of the block to allocate in bytes.
     * @returns The offset (pointer) to the beginning of the allocated block.
     */
    alloc(sizeInBytes: number): number {
        // Store the current offset as the start of the new block.
        const currentOffset = this.allocatedBytes;
        // Calculate the new offset after allocating the requested block.
        const newOffset = currentOffset + sizeInBytes;
        // Get the total size of the WebAssembly memory in bytes.
        const totalMemoryBytes = this.memory.buffer.byteLength;

        // If the new offset exceeds the total size of the memory, grow the memory.
        if (newOffset > totalMemoryBytes) {
            // Calculate the number of WebAssembly pages needed to fit the new allocation.
            // WebAssembly memory pages are 64KiB each.
            const neededPages = Math.ceil((newOffset - totalMemoryBytes) / 65536);
            // Grow the memory by the required number of pages.
            console.log(`GROW: ${neededPages} pages`);
            this.memory.grow(neededPages);
        }

        // Update the allocated bytes to the new offset.
        this.allocatedBytes = newOffset;
        // Return the offset at which the allocated block starts.
        return currentOffset;
    }

    /**
     * Returns the underlying buffer object.
     * 
     * @returns The buffer object.
     */
    getBuffer(): ArrayBuffer {
        return this.memory.buffer;
    }

    /**
     * Returns the Int32 view of the underlying buffer object.
     * 
     * @returns The view of the memory buffer as Int32Array.
     */
    getInt32Array(): Int32Array {
        return new Int32Array(this.memory.buffer);
    }

    /**
     * Returns the Float32 view of the underlying buffer object.
     * 
     * @returns The view of the memory buffer as Float32Array.
     */
    getFloat32Array(): Float32Array {
        return new Float32Array(this.memory.buffer);
    }

    /**
     * Returns the Float64 view of the underlying buffer object..
     * 
     * @returns The view of the memory buffer as Float64Array.
     */
    getFloat64Array(): Float64Array {
        return new Float64Array(this.memory.buffer);
    }
}

// Maximum number of soundfile parts.
const MAX_SOUNDFILE_PARTS = 256;

// Maximum number of channels.
const MAX_CHAN = 64;

// Maximum buffer size in frames.
const BUFFER_SIZE = 1024;

// Default sample rate.
const SAMPLE_RATE = 44100;

// Size of an integer in bytes.
const intSize = 4;

/**
 * Soundfile class to handle soundfile data in wasm memory.
 */
class Soundfile {
    private readonly fPtr: number; // Pointer to the soundfile structure in wasm memory
    private readonly fBuffers: number;
    private readonly fLength: number;
    private readonly fSR: number;
    private readonly fOffset: number;
    private readonly fSampleSize: number;
    private readonly fPtrSize: number;
    private readonly fAllocator: WasmAllocator;

    constructor(allocator: WasmAllocator, ptrSize: number, sampleSize: number, curChan: number, length: number, maxChan: number, totalParts: number) {
        // Keep the soundfile structure parameters

        this.fSampleSize = sampleSize;
        this.fPtrSize = ptrSize;
        this.fAllocator = allocator;

        // Allocate wasm memory for the soundfile structure
        this.fPtr = allocator.alloc(4 * ptrSize); // 4 ptrSize: fBuffers, fLength, fSR, fOffset
        this.fLength = allocator.alloc(MAX_SOUNDFILE_PARTS * intSize);
        this.fSR = allocator.alloc(MAX_SOUNDFILE_PARTS * intSize);
        this.fOffset = allocator.alloc(MAX_SOUNDFILE_PARTS * intSize);
        this.fBuffers = this.allocBuffers(curChan, length, maxChan);

        //this.displayMemory("Allocated soundfile structure 1");

        // Set the soundfile structure in wasm memory
        const HEAP32 = this.fAllocator.getInt32Array();
        HEAP32[this.fPtr >> 2] = this.fBuffers;
        HEAP32[(this.fPtr + ptrSize) >> 2] = this.fLength;
        HEAP32[(this.fPtr + 2 * ptrSize) >> 2] = this.fSR;
        HEAP32[(this.fPtr + 3 * ptrSize) >> 2] = this.fOffset;

        for (let chan = 0; chan < curChan; chan++) {
            const buffer: number = HEAP32[(this.fBuffers >> 2) + chan];
            console.log(`allocBuffers AFTER: ${chan} - ${buffer}`);
        }

        //this.displayMemory("Allocated soundfile structure 2");
    }

    private allocBuffers(curChan: number, length: number, maxChan: number): number {
        const buffers = this.fAllocator.alloc(maxChan * this.fPtrSize);

        console.log(`allocBuffers buffers: ${buffers}`);

        for (let chan = 0; chan < curChan; chan++) {
            const buffer: number = this.fAllocator.alloc(length * this.fSampleSize);
            // HEAP32 is the Int32Array view of the memory buffer which can change after grow in `alloc` method
            // so we need to recompute the buffer address
            const HEAP32 = this.fAllocator.getInt32Array();
            HEAP32[(buffers >> 2) + chan] = buffer;
        }
        //this.displayMemory("Allocated soundfile buffers");
        return buffers;
    }

    shareBuffers(curChan: number, maxChan: number) {
        // Share the same buffers for all other channels so that we have maxChan channels available
        const HEAP32 = this.fAllocator.getInt32Array();
        for (let chan = curChan; chan < maxChan; chan++) {
            HEAP32[(this.fBuffers >> 2) + chan] = HEAP32[(this.fBuffers >> 2) + chan % curChan];
        }
    }

    copyToOut(part: number, maxChannels: number, offset: number, buffer: AudioBuffer) {
        const HEAP32 = this.fAllocator.getInt32Array();
        HEAP32[(this.fLength >> 2) + part] = buffer.length;
        HEAP32[(this.fSR >> 2) + part] = buffer.sampleRate;
        HEAP32[(this.fOffset >> 2) + part] = offset;

        //this.displayMemory("IN copyToOut, BEFORE copyToOutReal", true);
        // Copy the soundfile data to the buffer
        if (this.fSampleSize === 8) {
            this.copyToOutReal64(maxChannels, offset, buffer);
        } else {
            this.copyToOutReal32(maxChannels, offset, buffer);
        }
        //this.displayMemory("IN copyToOut, AFTER copyToOutReal");
    }

    copyToOutReal32(maxChannels: number, offset: number, buffer: AudioBuffer) {
        const HEAP32 = this.fAllocator.getInt32Array();
        const HEAPF = this.fAllocator.getFloat32Array();
        for (let chan = 0; chan < buffer.numberOfChannels; chan++) {
            const input: Float32Array = buffer.getChannelData(chan);
            const output: number = HEAP32[(this.fBuffers >> 2) + chan];
            const outputReal: Float32Array = HEAPF.subarray((output + offset * this.fSampleSize) >> Math.log2(this.fSampleSize),
                (output + (offset + input.length) * this.fSampleSize) >> Math.log2(this.fSampleSize));
            for (let sample = 0; sample < input.length; sample++) {
                outputReal[sample] = input[sample];
            }
        }
    }

    copyToOutReal64(maxChannels: number, offset: number, buffer: AudioBuffer) {
        const HEAP32 = this.fAllocator.getInt32Array();
        const HEAPF = this.fAllocator.getFloat64Array();
        for (let chan = 0; chan < buffer.numberOfChannels; chan++) {
            const input: Float32Array = buffer.getChannelData(chan);
            const output: number = HEAP32[(this.fBuffers >> 2) + chan];
            const outputReal: Float64Array = HEAPF.subarray((output + offset * this.fSampleSize) >> Math.log2(this.fSampleSize),
                (output + (offset + input.length) * this.fSampleSize) >> Math.log2(this.fSampleSize));
            for (let sample = 0; sample < input.length; sample++) {
                outputReal[sample] = input[sample];
            }
        }
    }

    emptyFile(part: number, offset: number): number {
        // Set the soundfile buffer in wasm memory
        const HEAP32 = this.fAllocator.getInt32Array();
        HEAP32[(this.fLength >> 2) + part] = BUFFER_SIZE;
        HEAP32[(this.fSR >> 2) + part] = SAMPLE_RATE;
        HEAP32[(this.fOffset >> 2) + part] = offset;

        // Update and return the new offset
        return offset + BUFFER_SIZE;
    }

    displayMemory(where: string = "", mem: boolean = false) {
        console.log("Soundfile memory: " + where);
        console.log(`fPtr: ${this.fPtr}`);
        console.log(`fBuffers: ${this.fBuffers}`);
        console.log(`fLength: ${this.fLength}`);
        console.log(`fSR: ${this.fSR}`);
        console.log(`fOffset: ${this.fOffset}`);
        const HEAP32 = this.fAllocator.getInt32Array();
        if (mem) console.log(`HEAP32: ${HEAP32}`);
        console.log(`HEAP32[this.fPtr >> 2]: ${HEAP32[this.fPtr >> 2]}`);
        console.log(`HEAP32[(this.fPtr + ptrSize) >> 2]: ${HEAP32[(this.fPtr + this.fPtrSize) >> 2]}`);
        console.log(`HEAP32[(this.fPtr + 2 * ptrSize) >> 2]: ${HEAP32[(this.fPtr + 2 * this.fPtrSize) >> 2]}`);
        console.log(`HEAP32[(this.fPtr + 3 * ptrSize) >> 2]: ${HEAP32[(this.fPtr + 3 * this.fPtrSize) >> 2]}`);
    }

    // Return the pointer to the soundfile structure in wasm memory
    getPtr(): number {
        return this.fPtr;
    }

    getHEAP32(): Int32Array {
        return this.fAllocator.getInt32Array();
    }
    getHEAPFloat32(): Float32Array {
        return this.fAllocator.getFloat32Array();
    }

    getHEAPFloat64(): Float64Array {
        return this.fAllocator.getFloat64Array();
    }

}

// Definition of the AudioBufferItem type
type AudioBufferItem = {
    pathName: string;
    audioBuffer: AudioBuffer;
};

/**
 * SoundfileReader class to read soundfile data and copy it to the soundfile buffer.
 */
class SoundfileReader {

    private readonly fAllocator: WasmAllocator;
    private readonly fPtrSize: number;
    private readonly fSampleSize: number;
    private readonly fContext;
    private readonly fAudioBuffers: AudioBufferItem[];

    constructor(allocator: WasmAllocator, context: BaseAudioContext, ptrSize: number, sampleSize: number) {
        this.fAllocator = allocator;
        this.fPtrSize = ptrSize;
        this.fSampleSize = sampleSize;
        this.fContext = context;
        this.fAudioBuffers = [];
    }

    /**
     * Check if the file exists in the given directories.
     * 
     * @param directories : the list of directories to search for the file   
     * @param fileName : the name of the file to search for 
     * @returns : the path of the file if found, otherwise an empty string
     */
    private async checkFile(directories: string[], fileName: string): Promise<string> {

        async function checkFileExists(url: string): Promise<boolean> {
            try {
                console.log(`"checkFileExists" url: ${url}`);
                const response = await fetch(url, { method: 'HEAD' });
                return response.ok; // Will be true if the status code is 200-299
            } catch (error) {
                console.error('Fetch error:', error);
                return false;
            }
        }

        if (await checkFileExists(fileName)) {
            return fileName;
        } else {
            for (let i = 0; i < directories.length; i++) {
                const pathName = directories[i] + "/" + fileName;
                if (await checkFileExists(pathName)) {
                    return pathName;
                }
            }
            return "";
        }
    }

    /**
     * Check if all soundfiles exist and return their real path_name.
     * 
     * @param directories : the list of directories to search for the file
     * @param fileNameList : the list of file names to search for
     * @returns : the list of path names of the files if found, otherwise an empty string
     */
    async checkFiles(directories: string[], fileNameList: string[]): Promise<string[]> {
        const pathNameList: string[] = [];
        for (let i = 0; i < fileNameList.length; i++) {
            const pathName: string = await this.checkFile(directories, fileNameList[i]);
            console.log(`checkFiles pathName: ${pathName}`);
            // If 'pathName' is not found, it is replaced by an identifier for an empty sound (e.g., silence)
            pathNameList.push(pathName === "" ? "__empty_sound__" : pathName);
        }
        return pathNameList;
    }

    /**
     * Get the channels and length values of the given sound resource.
     * 
     * @param pathName : the name of the file, or sound resource identified this way
     * @returns channels and length of the soundfile
     */
    private async getParamsFile(pathName: string): Promise<{ channels: number, length: number }> {
        console.log(`Loading sound file from ${pathName}`);

        const item = this.fAudioBuffers.find((element: AudioBufferItem) => element.pathName === pathName);
        if (item) {
            console.log(`getItemByPathName FOUND`);
            return { channels: item.audioBuffer.numberOfChannels, length: item.audioBuffer.length };
        } else {
            const response = await fetch(pathName);
            if (!response.ok) {
                console.log(`Failed to load sound file from ${pathName}: ${response.statusText}`);
                return { channels: 1, length: BUFFER_SIZE };
            } else {

                // Decode the audio data
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.fContext.decodeAudioData(arrayBuffer);
                const { numberOfChannels, length } = audioBuffer;

                // Keep the audio buffer for later use
                this.fAudioBuffers.push({ pathName, audioBuffer });

                // Ensure the returned object keys match what's being returned
                return { channels: numberOfChannels, length };
            }
        }
    }

    /**
     * Read one sound resource and fill the 'soundfile' structure accordingly
     *
     * @param soundfile - the soundfile to be filled
     * @param pathName - the name of the file, or sound resource identified this way
     * @param part - the part number to be filled in the soundfile
     * @param maxChan - the maximum number of mono channels to fill
     * 
     * @returns the offset in the soundfile buffer
     *
     */
    private readFile(soundfile: Soundfile, pathName: string, part: number, offset: number, maxChan: number): number {
        // Read the soundfile
        const item = this.fAudioBuffers.find(entry => entry.pathName === pathName);
        // Copy the soundfile data to the buffer
        if (item) {
            //soundfile.displayMemory("BEFORE copyToOut");
            soundfile.copyToOut(part, maxChan, offset, item.audioBuffer);
            //soundfile.displayMemory("AFTER copyToOut");
            return offset + item.audioBuffer.length;
        } else {
            console.error(`Failed to access sound file from ${pathName}`);
            return offset + BUFFER_SIZE;
        }
    }

    /**
     * Crate a soundfile, load all parts and copy audio data to the wasm soundfile buffer.
     * @param pathNameList : list of soundfile paths
     * @param maxChan : maximum number of channels
     * @param isDouble : whether the soundfile will be copied as double
     */
    async createSoundfile(pathNameList: string[], maxChan: number, isDouble: boolean): Promise<Soundfile | null> {
        try {
            let curChan = 1; // At least one channel
            let totalLength = 0;

            // Compute total length and channels max of all files
            for (const pathName of pathNameList) {
                let chan: number = 0, len: number = 0;
                if (pathName === "__empty_sound__") {
                    length = BUFFER_SIZE;
                    chan = 1;
                } else {
                    const { channels, length } = await this.getParamsFile(pathName);
                    chan = channels;
                    len = length;
                }
                curChan = Math.max(curChan, chan);
                totalLength += len;
            }

            // Complete with empty parts
            totalLength += (MAX_SOUNDFILE_PARTS - pathNameList.length) * BUFFER_SIZE;

            // Create the soundfile
            let soundfile = new Soundfile(this.fAllocator, this.fPtrSize, this.fSampleSize, curChan, totalLength, maxChan, pathNameList.length);

            //soundfile.displayMemory("After soundfile creation");
            // Init offset
            let offset = 0;

            // Read all files
            for (let part = 0; part < pathNameList.length; part++) {
                if (pathNameList[part] === "__empty_sound__") {
                    // Empty sound
                    offset = soundfile.emptyFile(part, offset);
                } else {
                    // Read the soundfile and update the offset
                    offset = await this.readFile(soundfile, pathNameList[part], part, offset, maxChan);
                }
            }

            //soundfile.displayMemory("After reading soundfiles");

            // Complete with empty parts
            for (let part = pathNameList.length; part < MAX_SOUNDFILE_PARTS; part++) {
                offset = soundfile.emptyFile(part, offset);
            }

            //soundfile.displayMemory("After emptyFile");

            // Share the same buffers for all other channels so that we have maxChan channels available
            soundfile.shareBuffers(curChan, maxChan);

            //soundfile.displayMemory("After shareBuffers");

            return soundfile;

        } catch (error) {
            console.error("Failed to create soundfile:", error);
            return null;
        }
    }

    getHEAP32(): Int32Array {
        return this.fAllocator.getInt32Array();
    }
}

/**
 * DSP implementation: mimic the C++ 'dsp' class:
 * - adding MIDI control: metadata are decoded and incoming MIDI messages will control the associated controllers
 * - an output handler can be set to treat produced output controllers (like 'bargraph') 
 * - regular controllers are handled using setParamValue/getParamValue
 */
export interface IFaustBaseWebAudioDsp {
    /**
     * Set the parameter output handler, to  be called in the 'compute' method with output parameters (like bargraph).
     *
     * @param handler - the output handler
     */
    setOutputParamHandler(handler: OutputParamHandler | null): void;

    /**
     * Get the parameter output handler.
     *
     * @return the current output handler
     */
    getOutputParamHandler(): OutputParamHandler | null;

    /**
     * Set the compute handler, to  be called in the 'compute' method with buffer size.
     *
     * @param handler - the compute handler
     */
    setComputeHandler(handler: ComputeHandler | null): void;

    /**
     * Get the compute handler.
     *
     * @return the current output handler
     */
    getComputeHandler(): ComputeHandler | null;

    /**
     * Set the plot handler, to  be called in the 'compute' method with various info (see PlotHandler type).
     *
     * @param handler - the plot handler
     */
    setPlotHandler(handler: PlotHandler | null): void;

    /**
     * Get the plot handler.
     *
     * @return the current plot handler
     */
    getPlotHandler(): PlotHandler | null;

    /**
     * Return instance number of audio inputs.
     *
     * @return the instance number of audio inputs
     */
    getNumInputs(): number;

    /**
     * Return instance number of audio outputs.
     *
     * @return the instance number of audio outputs
     */
    getNumOutputs(): number;

    /**
     * DSP instance computation, to be called with successive input/output audio buffers, using their size.
     *
     * @param inputs - the input audio buffers
     * @param outputs - the output audio buffers
     */
    compute(inputs: Float32Array[], outputs: Float32Array[]): boolean;

    /**
     * Give a handler to be called on 'declare key value' kind of metadata.
     *
     * @param handler - the handler to be used
     */
    metadata(handler: MetadataHandler): void;

    /**
     * Handle untyped MIDI messages.
     *
     * @param data - and arry of MIDI bytes
     */
    midiMessage(data: number[] | Uint8Array): void;

    /**
     * Handle MIDI ctrlChange messages.
     *
     * @param channel - the MIDI channel (0..15, not used for now)
     * @param ctrl - the MIDI controller number (0..127)
     * @param value - the MIDI controller value (0..127)
     */
    ctrlChange(chan: number, ctrl: number, value: number): void;

    /**
     * Handle MIDI pitchWheel messages.
     *
     * @param channel - the MIDI channel (0..15, not used for now)
     * @param value - the MIDI controller value (0..16383)
     */
    pitchWheel(chan: number, value: number): void;

    /**
     * Set parameter value.
     *
     * @param path - the path to the wanted parameter (retrieved using 'getParams' method)
     * @param val - the float value for the wanted control
     */
    setParamValue(path: string, value: number): void;

    /**
     * Get parameter value.
     *
     * @param path - the path to the wanted parameter (retrieved using 'getParams' method)
     *
     * @return the float value
     */
    getParamValue(path: string): number;

    /**
     * Get the table of all input parameters paths.
     *
     * @return the table of all input parameters paths
     */
    getParams(): string[];

    /**
     * Get DSP JSON description with its UI and metadata as object.
     *
     * @return the DSP JSON description as object
     */
    getMeta(): FaustDspMeta;

    /**
     * Get DSP JSON description with its UI and metadata.
     *
     * @return the DSP JSON description
     */
    getJSON(): string;

    /**
     * Get DSP UI description.
     *
     * @return the DSP UI description
     */
    getUI(): FaustUIDescriptor;

    /**
    * Get DSP UI items description.
    *
    * @return the DSP UI items description
    */
    getDescriptors(): FaustUIInputItem[];

    /**
     * Start the DSP.
     */
    start(): void;

    /**
     * Stop the DSP.
     */
    stop(): void;

    /**
     * Destroy the DSP.
     */
    destroy(): void;
}

export interface IFaustMonoWebAudioDsp extends IFaustBaseWebAudioDsp { }
export interface IFaustMonoWebAudioNode extends IFaustMonoWebAudioDsp, AudioNode { }

export interface IFaustPolyWebAudioDsp extends IFaustBaseWebAudioDsp {
    /**
     * Handle MIDI keyOn messages.
     *
     * @param channel - the MIDI channel (0..15, not used for now)
     * @param pitch - the MIDI pitch value (0..127)
     * @param velocity - the MIDI velocity value (0..127)
     */
    keyOn(channel: number, pitch: number, velocity: number): void;

    /**
     * Handle MIDI keyOff messages.
     *
     * @param channel - the MIDI channel (0..15, not used for now)
     * @param pitch - the MIDI pitch value (0..127)
     * @param velocity - the MIDI velocity value (0..127)
     */
    keyOff(channel: number, pitch: number, velocity: number): void;

    /**
     * Stop all playing notes.
     *
     * @param hard - whether to immediately stop notes or put them in release mode
     */
    allNotesOff(hard: boolean): void;
}
export interface IFaustPolyWebAudioNode extends IFaustPolyWebAudioDsp, AudioNode { }

// Definition of the SoundfileItem type
type SoundfileItem = {
    name: string;      // Name of the soundfile
    url: string;       // URL of the soundfile
    basePtr: number;   // Base pointer in wasm memory
};

export class FaustBaseWebAudioDsp implements IFaustBaseWebAudioDsp {
    protected fOutputHandler: OutputParamHandler | null;
    protected fComputeHandler: ComputeHandler | null;

    // To handle MIDI events plot
    protected fPlotHandler: PlotHandler | null;
    protected fCachedEvents: { type: string; data: any }[];
    protected fBufferNum: number;

    protected fInChannels: Float32Array[] | Float64Array[];
    protected fOutChannels: Float32Array[] | Float64Array[];

    protected fOutputsTimer: number;

    // UI items path
    protected fInputsItems: string[];
    protected fOutputsItems: string[];
    protected fDescriptor: FaustUIInputItem[];

    // Soundfile handling
    protected fSoundfiles: SoundfileItem[];
    protected fEndMemory: number; // Keep the end of memory offset before soundfiles

    // Buffers in wasm memory
    protected fAudioInputs!: number;
    protected fAudioOutputs!: number;

    protected fBufferSize: number;
    protected fPtrSize: number;
    protected fSampleSize: number;

    // MIDI handling
    protected fPitchwheelLabel: { path: string; min: number; max: number }[];
    protected fCtrlLabel: { path: string; min: number; max: number }[][];
    protected fPathTable: { [address: string]: number };
    protected fUICallback: UIHandler;

    // Audio callback
    protected fProcessing: boolean;
    protected fDestroyed: boolean;
    protected fFirstCall: boolean;

    protected fJSONDsp!: FaustDspMeta;

    constructor(sampleSize: number, bufferSize: number) {
        this.fOutputHandler = null;
        this.fComputeHandler = null;

        // To handle MIDI events plot
        this.fCachedEvents = [];
        this.fBufferNum = 0;
        this.fPlotHandler = null;

        this.fBufferSize = bufferSize;

        this.fInChannels = [];
        this.fOutChannels = [];

        this.fPtrSize = sampleSize; // Done on wast/wasm backend side
        this.fSampleSize = sampleSize;

        this.fOutputsTimer = 5;
        this.fInputsItems = [];
        this.fOutputsItems = [];
        this.fDescriptor = [];

        this.fSoundfiles = [];

        this.fPitchwheelLabel = [];
        this.fCtrlLabel = new Array(128).fill(null).map(() => []);
        this.fPathTable = {};

        this.fProcessing = false;
        this.fDestroyed = false;
        this.fFirstCall = true;

        this.fUICallback = (item: FaustUIItem) => {
            if (item.type === "hbargraph" || item.type === "vbargraph") {
                // Keep bargraph adresses
                this.fOutputsItems.push(item.address);
                this.fPathTable[item.address] = item.index;
            } else if (item.type === "vslider" || item.type === "hslider" || item.type === "button" || item.type === "checkbox" || item.type === "nentry") {
                // Keep inputs adresses
                this.fInputsItems.push(item.address);
                this.fPathTable[item.address] = item.index;
                this.fDescriptor.push(item);
                // Parse 'midi' metadata
                if (!item.meta) return;
                item.meta.forEach((meta) => {
                    const { midi } = meta;
                    if (!midi) return;
                    const strMidi = midi.trim();
                    if (strMidi === "pitchwheel") {
                        this.fPitchwheelLabel.push({ path: item.address, min: item.min as number, max: item.max as number });
                    } else {
                        const matched = strMidi.match(/^ctrl\s(\d+)/);
                        if (!matched) return;
                        this.fCtrlLabel[parseInt(matched[1])].push({ path: item.address, min: item.min as number, max: item.max as number });
                    }
                });
            } else if (item.type === "soundfile") {
                this.fSoundfiles.push({ name: item.label, url: item.url, basePtr: -1 });
            }
        }
    }

    // Tools
    static remap(v: number, mn0: number, mx0: number, mn1: number, mx1: number) {
        return (v - mn0) / (mx0 - mn0) * (mx1 - mn1) + mn1;
    }

    // JSON parsing functions
    static parseUI(ui: FaustUIDescriptor, callback: (item: FaustUIItem) => any) {
        ui.forEach(group => this.parseGroup(group, callback));
    }

    static parseGroup(group: FaustUIGroup, callback: (item: FaustUIItem) => any) {
        if (group.items) {
            this.parseItems(group.items, callback);
        }
    }
    static parseItems(items: FaustUIItem[], callback: (item: FaustUIItem) => any) {
        items.forEach(item => this.parseItem(item, callback));
    }

    static parseItem(item: FaustUIItem, callback: (item: FaustUIItem) => any) {
        if (item.type === "vgroup" || item.type === "hgroup" || item.type === "tgroup") {
            this.parseItems(item.items, callback);
        } else {
            callback(item);
        }
    }

    // Split the soundfile names and return an array of names
    static splitNames(input: string): string[] {
        // Trim off the curly braces at the start and end, if present
        let trimmed = input.replace(/^\{|\}$/g, '');
        // Split the string into an array of strings and remove first and last characters
        return trimmed.split(";").map(str => str.length <= 2 ? '' : str.substring(1, str.length - 1));
    }
    /**
     *  Load a soundfile possibly containing several parts. 
     * 
     * @param sfReader : the soundfile reader 
     * @param sfOffset : the offset in the wasm memory
     * @param name : the name of the soundfile
     * @param url : the url of the soundfile
     */
    private async loadSoundfile(sfReader: SoundfileReader, sfOffset: number, name: string, url: string): Promise<void> {

        console.log(`Soundfile ${name} paths: ${url}`);

        // Add standard directories to look for soundfiles
        const sfDirectories: string[] = ["", ".", "http://127.0.0.1:8000"];

        console.log(`sfDirectories ${sfDirectories}`);

        // Check if the soundfile exists in the given directories and return the real path
        const sfPathNames: string[] = await sfReader.checkFiles(sfDirectories, FaustBaseWebAudioDsp.splitNames(url));

        console.log(`Soundfile ${name} paths: ${sfPathNames}`);

        const item = this.fSoundfiles.find((element: SoundfileItem) => element.url === url);
        if (item) {
            // Use the cached Soundfile
            if (item.basePtr !== -1) {
                // Update HEAP32 after soundfile creation
                const HEAP32 = sfReader.getHEAP32();

                // Fill the soundfile structure in wasm memory, sounfiles are at the beginning of the DSP memory
                console.log(`Soundfile ${name} loaded at ${item.basePtr} in wasm memory with sfOffset ${sfOffset}`);
                console.log(`Soundfile CACHE ${url}}`);

                HEAP32[sfOffset >> 2] = item.basePtr;
            } else {

                // Create the soundfiles
                const soundfile = await sfReader.createSoundfile(sfPathNames, MAX_CHAN, this.fSampleSize === 8);
                if (soundfile) {

                    //soundfile.displayMemory("After createSoundfile");

                    // Update HEAP32 after soundfile creation
                    const HEAP32 = soundfile.getHEAP32();

                    // Fill the soundfile structure in wasm memory, sounfiles are at the beginning of the DSP memory
                    item.basePtr = soundfile.getPtr();
                    console.log(`Soundfile ${name} loaded at ${item.basePtr} in wasm memory with sfOffset ${sfOffset}`);

                    HEAP32[sfOffset >> 2] = item.basePtr;

                } else {
                    console.log(`Soundfile ${name} for ${url} cannot be created !}`);
                }
            }
        } else {
            console.log(`Soundfile with ${url} cannot be found !}`);
        }
    }

    /** 
     * Init soundfiles memory.
     * 
     * Soundfile pointers are located at the beginning of the DSP struct memory (one after the other), 
     * so that the TS scode can setup them easily.
    */
    protected async initSoundfileMemory(allocator: WasmAllocator, sfReader: SoundfileReader, baseDSP: number): Promise<void> {
        // Create and fill the soundfile structure
        let sfOffset: number = baseDSP;
        for (const { name, url } of this.fSoundfiles) {
            await this.loadSoundfile(sfReader, sfOffset, name, url);
            sfOffset += this.fPtrSize;
        };
    }

    protected updateOutputs() {
        if (this.fOutputsItems.length > 0 && this.fOutputHandler && this.fOutputsTimer-- === 0) {
            this.fOutputsTimer = 5;
            this.fOutputsItems.forEach(item => this.fOutputHandler?.(item, this.getParamValue(item)));
        }
    }

    // Public API
    metadata(handler: MetadataHandler) {
        if (this.fJSONDsp.meta) {
            this.fJSONDsp.meta.forEach(meta => handler(Object.keys(meta)[0], meta[Object.keys(meta)[0]]));
        }
    }

    compute(input: Float32Array[], output: Float32Array[]) {
        return false;
    }

    setOutputParamHandler(handler: OutputParamHandler | null) {
        this.fOutputHandler = handler;
    }
    getOutputParamHandler() {
        return this.fOutputHandler;
    }

    setComputeHandler(handler: ComputeHandler | null) {
        this.fComputeHandler = handler;
    }
    getComputeHandler() {
        return this.fComputeHandler;
    }

    setPlotHandler(handler: PlotHandler | null) {
        this.fPlotHandler = handler;
    }
    getPlotHandler() {
        return this.fPlotHandler;
    }

    getNumInputs() {
        return -1;
    }
    getNumOutputs() {
        return -1;
    }

    midiMessage(data: number[] | Uint8Array) {
        if (this.fPlotHandler) this.fCachedEvents.push({ data, type: "midi" });
        const cmd = data[0] >> 4;
        const channel = data[0] & 0xf;
        const data1 = data[1];
        const data2 = data[2];
        if (cmd === 11) return this.ctrlChange(channel, data1, data2);
        if (cmd === 14) return this.pitchWheel(channel, (data2 * 128.0 + data1));
    }

    ctrlChange(channel: number, ctrl: number, value: number) {
        if (this.fPlotHandler) this.fCachedEvents.push({ type: "ctrlChange", data: [channel, ctrl, value] });
        if (this.fCtrlLabel[ctrl].length) {
            this.fCtrlLabel[ctrl].forEach((ctrl) => {
                const { path } = ctrl;
                this.setParamValue(path, FaustBaseWebAudioDsp.remap(value, 0, 127, ctrl.min, ctrl.max));
                // Typically used to reflect parameter change on GUI
                if (this.fOutputHandler) this.fOutputHandler(path, this.getParamValue(path));
            });
        }
    }

    pitchWheel(channel: number, wheel: number) {
        if (this.fPlotHandler) this.fCachedEvents.push({ type: "pitchWheel", data: [channel, wheel] });
        this.fPitchwheelLabel.forEach((pw) => {
            this.setParamValue(pw.path, FaustBaseWebAudioDsp.remap(wheel, 0, 16383, pw.min, pw.max));
            // Typically used to reflect parameter change on GUI
            if (this.fOutputHandler) this.fOutputHandler(pw.path, this.getParamValue(pw.path));
        });
    }

    setParamValue(path: string, value: number) { }
    getParamValue(path: string) { return 0; }

    getParams() { return this.fInputsItems; }
    getMeta() { return this.fJSONDsp; }
    getJSON() { return JSON.stringify(this.getMeta()); }
    getUI() { return this.fJSONDsp.ui; }
    getDescriptors() { return this.fDescriptor; }

    hasSoundfiles() { return this.fSoundfiles.length > 0; }

    start() {
        this.fProcessing = true;
    }

    stop() {
        this.fProcessing = false;
    }

    destroy() {
        this.fDestroyed = true;
        this.fOutputHandler = null;
        this.fComputeHandler = null;
        this.fPlotHandler = null;
    }
}

export class FaustMonoWebAudioDsp extends FaustBaseWebAudioDsp implements IFaustMonoWebAudioDsp {

    private fInstance: FaustMonoDspInstance;
    private fDSP!: number;

    constructor(instance: FaustMonoDspInstance, sampleRate: number, sampleSize: number, bufferSize: number) {

        super(sampleSize, bufferSize);
        this.fInstance = instance;

        // Create JSON object
        this.fJSONDsp = JSON.parse(this.fInstance.json);

        // Setup GUI
        FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);

        // Setup wasm memory
        this.fEndMemory = this.initMemory();

        // Init DSP
        this.fInstance.api.init(this.fDSP, sampleRate);
    }

    async init(context: BaseAudioContext | null): Promise<void> {

        // Init soundfiles memory is needed
        if (this.fSoundfiles.length > 0 && context) {

            // Create memory allocator for soundfiles in wasm memory, starting at the end of DSP memory
            const allocator = new WasmAllocator(this.fInstance.memory, this.fEndMemory);

            // Create soundfile reader
            const sfReader = new SoundfileReader(allocator, context, this.fPtrSize, this.fSampleSize);

            // Init soundfiles memory
            await this.initSoundfileMemory(allocator, sfReader, this.fDSP);
        }
    }

    private initMemory(): number {

        // Start of DSP memory: Mono DSP is placed first with index 0
        this.fDSP = 0;

        // Audio buffer start at the end of DSP
        const $audio = this.fJSONDsp.size;

        // Setup audio pointers offset
        this.fAudioInputs = $audio;
        this.fAudioOutputs = this.fAudioInputs + this.getNumInputs() * this.fPtrSize;

        // Prepare wasm memory layout
        const $audioInputs = this.fAudioOutputs + this.getNumOutputs() * this.fPtrSize;
        const $audioOutputs = $audioInputs + this.getNumInputs() * this.fBufferSize * this.fSampleSize;
        // Compute memory end in bytes
        const endMemory = $audioOutputs + this.getNumOutputs() * this.fBufferSize * this.fSampleSize;

        // Setup Int32 and Real views of the memory
        const HEAP = this.fInstance.memory.buffer;
        const HEAP32 = new Int32Array(HEAP);
        const HEAPF = (this.fSampleSize === 4) ? new Float32Array(HEAP) : new Float64Array(HEAP);

        if (this.getNumInputs() > 0) {
            for (let chan = 0; chan < this.getNumInputs(); chan++) {
                HEAP32[(this.fAudioInputs >> 2) + chan] = $audioInputs + this.fBufferSize * this.fSampleSize * chan;
            }
            // Prepare Ins buffer tables
            const dspInChans = HEAP32.subarray(this.fAudioInputs >> 2, (this.fAudioInputs + this.getNumInputs() * this.fPtrSize) >> 2);
            for (let chan = 0; chan < this.getNumInputs(); chan++) {
                this.fInChannels[chan] = HEAPF.subarray(dspInChans[chan] >> Math.log2(this.fSampleSize), (dspInChans[chan] + this.fBufferSize * this.fSampleSize) >> Math.log2(this.fSampleSize));
            }
        }
        if (this.getNumOutputs() > 0) {
            for (let chan = 0; chan < this.getNumOutputs(); chan++) {
                HEAP32[(this.fAudioOutputs >> 2) + chan] = $audioOutputs + this.fBufferSize * this.fSampleSize * chan;
            }
            // Prepare Out buffer tables
            const dspOutChans = HEAP32.subarray(this.fAudioOutputs >> 2, (this.fAudioOutputs + this.getNumOutputs() * this.fPtrSize) >> 2);
            for (let chan = 0; chan < this.getNumOutputs(); chan++) {
                this.fOutChannels[chan] = HEAPF.subarray(dspOutChans[chan] >> Math.log2(this.fSampleSize), (dspOutChans[chan] + this.fBufferSize * this.fSampleSize) >> Math.log2(this.fSampleSize));
            }
        }

        return endMemory;
    }

    toString() {
        return `============== Mono Memory layout ==============
        this.fBufferSize: ${this.fBufferSize}
        this.fJSONDsp.size: ${this.fJSONDsp.size}
        this.fAudioInputs: ${this.fAudioInputs}
        this.fAudioOutputs: ${this.fAudioOutputs}
        this.fDSP: ${this.fDSP}`;
    }

    // Public API
    compute(input: Float32Array[] | ((input: Float32Array[] | Float64Array[]) => any), output: Float32Array[] | ((output: Float32Array[] | Float64Array[]) => any)) {

        // Check DSP state
        if (this.fDestroyed) return false;

        // Check Processing state: the node returns 'true' to stay in the graph, even if not processing
        if (!this.fProcessing) return true;

        // Init memory again on first call (since WebAssembly.memory.grow() may have been called)
        if (this.fFirstCall) {
            this.initMemory();
            this.fFirstCall = false;
        }

        if (typeof input === "function") {
            // Call input callback to avoid array copy
            input(this.fInChannels);
        } else {
            // Check inputs
            if (this.getNumInputs() > 0 && (!input || !input[0] || input[0].length === 0)) {
                // console.log("Process input error");
                return true;
            }

            // Check outputs
            if (this.getNumOutputs() > 0 && typeof output !== "function" && (!output || !output[0] || output[0].length === 0)) {
                // console.log("Process output error");
                return true;
            }

            // Copy inputs
            if (input !== undefined) {
                for (let chan = 0; chan < Math.min(this.getNumInputs(), input.length); chan++) {
                    const dspInput = this.fInChannels[chan];
                    dspInput.set(input[chan]);
                }
            }
        }
        // Possibly call an externally given callback (for instance to synchronize playing a MIDIFile...)
        if (this.fComputeHandler) this.fComputeHandler(this.fBufferSize);

        // Compute
        this.fInstance.api.compute(this.fDSP, this.fBufferSize, this.fAudioInputs, this.fAudioOutputs);

        // Update bargraph
        this.updateOutputs();

        let forPlot = this.fOutChannels;
        if (typeof output === "function") {
            // Call output callback to avoid array copy
            output(this.fOutChannels);
        } else {
            // Copy outputs
            for (let chan = 0; chan < Math.min(this.getNumOutputs(), output.length); chan++) {
                const dspOutput = this.fOutChannels[chan];
                output[chan].set(dspOutput);
            }
            forPlot = output;
        }

        // PlotHandler handling 
        if (this.fPlotHandler) {
            this.fPlotHandler(forPlot, this.fBufferNum++, (this.fCachedEvents.length ? this.fCachedEvents : undefined));
            this.fCachedEvents = [];
        }

        return true;
    }

    metadata(handler: MetadataHandler) { super.metadata(handler); }

    getNumInputs() {
        return this.fInstance.api.getNumInputs(this.fDSP);
    }
    getNumOutputs() {
        return this.fInstance.api.getNumOutputs(this.fDSP);
    }

    setParamValue(path: string, value: number) {
        if (this.fPlotHandler) this.fCachedEvents.push({ type: "param", data: { path, value } });
        this.fInstance.api.setParamValue(this.fDSP, this.fPathTable[path], value);
    }
    getParamValue(path: string) {
        return this.fInstance.api.getParamValue(this.fDSP, this.fPathTable[path]);
    }

    getMeta() { return this.fJSONDsp; }
    getJSON() { return this.fInstance.json; }
    getDescriptors() { return this.fDescriptor; }
    getUI() { return this.fJSONDsp.ui; }
}

export class FaustWebAudioDspVoice {

    static kActiveVoice: number;
    static kFreeVoice: number;
    static kReleaseVoice: number;
    static kLegatoVoice: number;
    static kNoVoice: number;
    static VOICE_STOP_LEVEL: number;
    private fFreqLabel: number[];
    private fGateLabel: number[];
    private fGainLabel: number[];
    private fKeyLabel: number[];
    private fVelLabel: number[];
    private fDSP: number;            // Voice DSP location in wasm memory
    private fAPI: IFaustDspInstance; // Voice DSP code
    // Accessed by PolyDSPImp class
    fCurNote: number;
    fNextNote: number;
    fNextVel: number;
    fDate: number;
    fLevel: number;
    fRelease: number;

    constructor($dsp: number, api: IFaustDspInstance, inputItems: string[], pathTable: { [address: string]: number }, sampleRate: number) {
        // Voice state
        FaustWebAudioDspVoice.kActiveVoice = 0;
        FaustWebAudioDspVoice.kFreeVoice = -1;
        FaustWebAudioDspVoice.kReleaseVoice = -2;
        FaustWebAudioDspVoice.kLegatoVoice = -3;
        FaustWebAudioDspVoice.kNoVoice = -4;
        FaustWebAudioDspVoice.VOICE_STOP_LEVEL = 0.0005;

        this.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
        this.fNextNote = this.fNextVel = -1;
        this.fLevel = 0;
        this.fDate = this.fRelease = 0;
        this.fDSP = $dsp;
        this.fAPI = api;
        this.fGateLabel = [];
        this.fGainLabel = [];
        this.fFreqLabel = [];
        this.fKeyLabel = [];
        this.fVelLabel = [];
        this.fAPI.init(this.fDSP, sampleRate);
        this.extractPaths(inputItems, pathTable);
    }

    static midiToFreq(note: number) { return 440.0 * 2 ** ((note - 69) / 12); }

    static normalizeVelocity(velocity: number) { return velocity / 127.0; }

    private extractPaths(inputItems: string[], pathTable: { [address: string]: number }) {
        inputItems.forEach((item) => {
            if (item.endsWith("/gate")) {
                this.fGateLabel.push(pathTable[item]);
            } else if (item.endsWith("/freq")) {
                this.fFreqLabel.push(pathTable[item]);
            } else if (item.endsWith("/key")) {
                this.fKeyLabel.push(pathTable[item]);
            } else if (item.endsWith("/gain")) {
                this.fGainLabel.push(pathTable[item]);
            } else if (item.endsWith("/vel") && item.endsWith("/velocity")) {
                this.fVelLabel.push(pathTable[item]);
            }
        });
    }

    // Public API
    keyOn(pitch: number, velocity: number, legato: boolean = false) {
        if (legato) {
            this.fNextNote = pitch;
            this.fNextVel = velocity;
        } else {
            this.fFreqLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, FaustWebAudioDspVoice.midiToFreq(pitch)));
            this.fGateLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, 1));
            this.fGainLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, FaustWebAudioDspVoice.normalizeVelocity(velocity)));
            this.fKeyLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, pitch));
            this.fVelLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, velocity));
            // Keep pitch
            this.fCurNote = pitch;
        }
    }

    keyOff(hard: boolean = false) {
        this.fGateLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, 0));
        if (hard) {
            this.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
        } else {
            this.fRelease = this.fAPI.getSampleRate(this.fDSP) / 2;
            this.fCurNote = FaustWebAudioDspVoice.kReleaseVoice;
        }
    }

    computeLegato(bufferSize: number, $inputs: number, $outputZero: number, $outputsHalf: number) {

        let size = bufferSize / 2;

        // Reset envelops
        this.fGateLabel.forEach(index => this.fAPI.setParamValue(this.fDSP, index, 0));

        // Compute current voice on half buffer
        this.fAPI.compute(this.fDSP, size, $inputs, $outputZero);

        // Start next keyOn
        this.keyOn(this.fNextNote, this.fNextVel);

        // Compute on second half buffer
        this.fAPI.compute(this.fDSP, size, $inputs, $outputsHalf);
    }

    compute(bufferSize: number, $inputs: number, $outputs: number) {
        this.fAPI.compute(this.fDSP, bufferSize, $inputs, $outputs);
    }

    setParamValue(index: number, value: number) {
        this.fAPI.setParamValue(this.fDSP, index, value);
    }
    getParamValue(index: number) {
        return this.fAPI.getParamValue(this.fDSP, index);
    }
}

export class FaustPolyWebAudioDsp extends FaustBaseWebAudioDsp implements IFaustPolyWebAudioDsp {

    private fInstance: FaustPolyDspInstance;
    private fEffect!: number;
    private fJSONEffect: FaustDspMeta | null;
    private fAudioMixing!: number;
    private fAudioMixingHalf!: number;
    private fVoiceTable: FaustWebAudioDspVoice[];

    constructor(instance: FaustPolyDspInstance, sampleRate: number, sampleSize: number, bufferSize: number) {
        super(sampleSize, bufferSize);
        this.fInstance = instance;

        // Create JSON for voice
        this.fJSONDsp = JSON.parse(this.fInstance.voiceJSON);

        // Create JSON for effect
        this.fJSONEffect = (this.fInstance.effectAPI && this.fInstance.effectJSON) ? JSON.parse(this.fInstance.effectJSON) : null;

        // Setup GUI
        FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);
        if (this.fJSONEffect) FaustBaseWebAudioDsp.parseUI(this.fJSONEffect.ui, this.fUICallback);

        // Setup wasm memory
        this.fEndMemory = this.initMemory();

        // Init DSP voices
        this.fVoiceTable = [];
        for (let voice = 0; voice < this.fInstance.voices; voice++) {
            this.fVoiceTable.push(new FaustWebAudioDspVoice(
                this.fJSONDsp.size * voice,
                this.fInstance.voiceAPI,
                this.fInputsItems,
                this.fPathTable,
                sampleRate
            ));
        }

        // Init effect
        if (this.fInstance.effectAPI) this.fInstance.effectAPI.init(this.fEffect, sampleRate);
    }

    async init(context: BaseAudioContext | null): Promise<void> {

        // Init soundfiles memory is needed
        if (this.fSoundfiles.length > 0 && context) {

            // Create memory allocator for soundfiles in wasm memory, starting at the end of DSP memory
            const allocator = new WasmAllocator(this.fInstance.memory, this.fEndMemory);

            // Create soundfile reader
            const sfReader = new SoundfileReader(allocator, context, this.fPtrSize, this.fSampleSize);

            // Init soundfiles memory for all voices
            for (let voice = 0; voice < this.fInstance.voices; voice++) {
                await this.initSoundfileMemory(allocator, sfReader, this.fJSONDsp.size * voice);
            }
        }
    }

    private initMemory() {

        // Effet start at the end of all DSP voices
        this.fEffect = this.fJSONDsp.size * this.fInstance.voices;

        // Audio buffer start at the end of effect
        const $audio = this.fEffect + (this.fJSONEffect ? this.fJSONEffect.size : 0);

        // Setup audio pointers offset
        this.fAudioInputs = $audio;
        this.fAudioOutputs = this.fAudioInputs + this.getNumInputs() * this.fPtrSize;
        this.fAudioMixing = this.fAudioOutputs + this.getNumOutputs() * this.fPtrSize;
        this.fAudioMixingHalf = this.fAudioMixing + this.getNumOutputs() * this.fPtrSize;

        // Prepare wasm memory layout
        const $audioInputs = this.fAudioMixingHalf + this.getNumOutputs() * this.fPtrSize;
        const $audioOutputs = $audioInputs + this.getNumInputs() * this.fBufferSize * this.fSampleSize;
        const $audioMixing = $audioOutputs + this.getNumOutputs() * this.fBufferSize * this.fSampleSize;

        // Compute memory end in bytes
        const endMemory = $audioMixing + this.getNumOutputs() * this.fBufferSize * this.fSampleSize;

        // Setup Int32 and Real views of the memory
        const HEAP = this.fInstance.memory.buffer;
        const HEAP32 = new Int32Array(HEAP);
        const HEAPF = (this.fSampleSize === 4) ? new Float32Array(HEAP) : new Float64Array(HEAP);

        if (this.getNumInputs() > 0) {
            for (let chan = 0; chan < this.getNumInputs(); chan++) {
                HEAP32[(this.fAudioInputs >> 2) + chan] = $audioInputs + this.fBufferSize * this.fSampleSize * chan;
            }
            // Prepare Ins buffer tables
            const dspInChans = HEAP32.subarray(this.fAudioInputs >> 2, (this.fAudioInputs + this.getNumInputs() * this.fPtrSize) >> 2);
            for (let chan = 0; chan < this.getNumInputs(); chan++) {
                this.fInChannels[chan] = HEAPF.subarray(dspInChans[chan] >> Math.log2(this.fSampleSize), (dspInChans[chan] + this.fBufferSize * this.fSampleSize) >> Math.log2(this.fSampleSize));
            }
        }
        if (this.getNumOutputs() > 0) {
            for (let chan = 0; chan < this.getNumOutputs(); chan++) {
                HEAP32[(this.fAudioOutputs >> 2) + chan] = $audioOutputs + this.fBufferSize * this.fSampleSize * chan;
                HEAP32[(this.fAudioMixing >> 2) + chan] = $audioMixing + this.fBufferSize * this.fSampleSize * chan;
                HEAP32[(this.fAudioMixingHalf >> 2) + chan] = $audioMixing + this.fBufferSize * this.fSampleSize * chan + this.fBufferSize / 2 * this.fSampleSize;
            }
            // Prepare Out buffer tables
            const dspOutChans = HEAP32.subarray(this.fAudioOutputs >> 2, (this.fAudioOutputs + this.getNumOutputs() * this.fPtrSize) >> 2);
            for (let chan = 0; chan < this.getNumOutputs(); chan++) {
                this.fOutChannels[chan] = HEAPF.subarray(dspOutChans[chan] >> Math.log2(this.fSampleSize), (dspOutChans[chan] + this.fBufferSize * this.fSampleSize) >> Math.log2(this.fSampleSize));
            }
        }

        return endMemory;
    }

    toString() {
        return `============== Poly Memory layout ==============
        this.fBufferSize: ${this.fBufferSize}
        this.fJSONDsp.size: ${this.fJSONDsp.size}
        this.fAudioInputs: ${this.fAudioInputs}
        this.fAudioOutputs: ${this.fAudioOutputs}
        this.fAudioMixing: ${this.fAudioMixing}
        this.fAudioMixingHalf: ${this.fAudioMixingHalf}`;
    }

    private allocVoice(voice: number, type: number) {
        this.fVoiceTable[voice].fDate++;
        this.fVoiceTable[voice].fCurNote = type;
        return voice;
    }

    private getPlayingVoice(pitch: number) {
        let voicePlaying = FaustWebAudioDspVoice.kNoVoice;
        let oldestDatePlaying = Number.MAX_VALUE;

        for (let voice = 0; voice < this.fInstance.voices; voice++) {
            if (this.fVoiceTable[voice].fCurNote === pitch) {
                // Keeps oldest playing voice
                if (this.fVoiceTable[voice].fDate < oldestDatePlaying) {
                    oldestDatePlaying = this.fVoiceTable[voice].fDate;
                    voicePlaying = voice;
                }
            }
        }
        return voicePlaying;
    }

    private getFreeVoice() {
        for (let voice = 0; voice < this.fInstance.voices; voice++) {
            if (this.fVoiceTable[voice].fCurNote === FaustWebAudioDspVoice.kFreeVoice) {
                return this.allocVoice(voice, FaustWebAudioDspVoice.kActiveVoice);
            }
        }

        let voiceRelease = FaustWebAudioDspVoice.kNoVoice;
        let voicePlaying = FaustWebAudioDspVoice.kNoVoice;
        let oldestDateRelease = Number.MAX_VALUE;
        let oldestDatePlaying = Number.MAX_VALUE;

        for (let voice = 0; voice < this.fInstance.voices; voice++) { // Scan all voices
            // Try to steal a voice in DspVoice.kReleaseVoice mode...
            if (this.fVoiceTable[voice].fCurNote === FaustWebAudioDspVoice.kReleaseVoice) {
                // Keeps oldest release voice
                if (this.fVoiceTable[voice].fDate < oldestDateRelease) {
                    oldestDateRelease = this.fVoiceTable[voice].fDate;
                    voiceRelease = voice;
                }
            } else if (this.fVoiceTable[voice].fDate < oldestDatePlaying) {
                oldestDatePlaying = this.fVoiceTable[voice].fDate;
                voicePlaying = voice;
            }
        }
        // Then decide which one to steal
        if (oldestDateRelease !== Number.MAX_VALUE) {
            console.log(`Steal release voice : voice_date = ${this.fVoiceTable[voiceRelease].fDate} voice = ${voiceRelease}`);
            return this.allocVoice(voiceRelease, FaustWebAudioDspVoice.kLegatoVoice);
        }
        if (oldestDatePlaying !== Number.MAX_VALUE) {
            console.log(`Steal playing voice : voice_date = ${this.fVoiceTable[voicePlaying].fDate} voice = ${voicePlaying}`);
            return this.allocVoice(voicePlaying, FaustWebAudioDspVoice.kLegatoVoice);
        }
        return FaustWebAudioDspVoice.kNoVoice;
    }

    // Public API
    compute(input: Float32Array[], output: Float32Array[]) {

        // Check DSP state
        if (this.fDestroyed) return false;

        // Init memory again on first call (since WebAssembly.memory.grow() may have been called)
        if (this.fFirstCall) {
            this.initMemory();
            this.fFirstCall = false;
        }

        // Check Processing state: the node returns 'true' to stay in the graph, even if not processing
        if (!this.fProcessing) return true;

        // Check inputs
        if (this.getNumInputs() > 0 && (!input || !input[0] || input[0].length === 0)) {
            // console.log("Process input error");
            return true;
        }

        // Check outputs
        if (this.getNumOutputs() > 0 && (!output || !output[0] || output[0].length === 0)) {
            // console.log("Process output error");
            return true;
        }

        // Copy inputs
        if (input !== undefined) {
            for (let chan = 0; chan < Math.min(this.getNumInputs(), input.length); ++chan) {
                const dspInput = this.fInChannels[chan];
                dspInput.set(input[chan]);
            }
        }

        // Possibly call an externally given callback (for instance to synchronize playing a MIDIFile...)
        if (this.fComputeHandler) this.fComputeHandler(this.fBufferSize);

        // Compute
        this.fInstance.mixerAPI.clearOutput(this.fBufferSize, this.getNumOutputs(), this.fAudioOutputs);
        this.fVoiceTable.forEach((voice) => {
            if (voice.fCurNote === FaustWebAudioDspVoice.kLegatoVoice) {
                // Play from current note and next note
                voice.computeLegato(this.fBufferSize, this.fAudioInputs, this.fAudioMixing, this.fAudioMixingHalf);
                // FadeOut on first half buffer
                this.fInstance.mixerAPI.fadeOut(this.fBufferSize / 2, this.getNumOutputs(), this.fAudioMixing);
                // Mix it in result
                voice.fLevel = this.fInstance.mixerAPI.mixCheckVoice(this.fBufferSize, this.getNumOutputs(), this.fAudioMixing, this.fAudioOutputs);
            } else if (voice.fCurNote !== FaustWebAudioDspVoice.kFreeVoice) {
                // Compute current note
                voice.compute(this.fBufferSize, this.fAudioInputs, this.fAudioMixing);
                // Mix it in result
                voice.fLevel = this.fInstance.mixerAPI.mixCheckVoice(this.fBufferSize, this.getNumOutputs(), this.fAudioMixing, this.fAudioOutputs);
                // Check the level to possibly set the voice in kFreeVoice again
                voice.fRelease -= this.fBufferSize;
                if ((voice.fCurNote == FaustWebAudioDspVoice.kReleaseVoice) && ((voice.fLevel < FaustWebAudioDspVoice.VOICE_STOP_LEVEL) && (voice.fRelease < 0))) {
                    voice.fCurNote = FaustWebAudioDspVoice.kFreeVoice;
                }
            }
        });
        if (this.fInstance.effectAPI) this.fInstance.effectAPI.compute(this.fEffect, this.fBufferSize, this.fAudioOutputs, this.fAudioOutputs);

        // Update bargraph
        this.updateOutputs();

        if (output !== undefined) {
            // Copy outputs
            for (let chan = 0; chan < Math.min(this.getNumOutputs(), output.length); chan++) {
                const dspOutput = this.fOutChannels[chan];
                output[chan].set(dspOutput);
            }

            // PlotHandler handling 
            if (this.fPlotHandler) {
                this.fPlotHandler(output, this.fBufferNum++, (this.fCachedEvents.length ? this.fCachedEvents : undefined));
                this.fCachedEvents = [];
            }
        }

        return true;
    }

    getNumInputs() {
        return this.fInstance.voiceAPI.getNumInputs(0);
    }
    getNumOutputs() {
        return this.fInstance.voiceAPI.getNumOutputs(0);
    }

    private static findPath(o: any, p: string) {
        if (typeof o !== "object") {
            return false;
        } else if (o.address) {
            return (o.address === p);
        } else {
            for (const k in o) {
                if (FaustPolyWebAudioDsp.findPath(o[k], p)) return true;
            }
            return false;
        }
    }

    setParamValue(path: string, value: number) {
        if (this.fPlotHandler) this.fCachedEvents.push({ type: "param", data: { path, value } });
        if (this.fJSONEffect && FaustPolyWebAudioDsp.findPath(this.fJSONEffect.ui, path) && this.fInstance.effectAPI) {
            this.fInstance.effectAPI.setParamValue(this.fEffect, this.fPathTable[path], value);
        } else {
            this.fVoiceTable.forEach(voice => voice.setParamValue(this.fPathTable[path], value));
        }
    }
    getParamValue(path: string) {
        if (this.fJSONEffect && FaustPolyWebAudioDsp.findPath(this.fJSONEffect.ui, path) && this.fInstance.effectAPI) {
            return this.fInstance.effectAPI.getParamValue(this.fEffect, this.fPathTable[path]);
        } else {
            return this.fVoiceTable[0].getParamValue(this.fPathTable[path]);
        }
    }

    getMeta() {
        const o = this.fJSONDsp;
        const e = this.fJSONEffect;
        const r = { ...o };
        if (e) {
            r.ui = [{
                type: "tgroup", label: "Sequencer", items: [
                    { type: "vgroup", label: "Instrument", items: o.ui },
                    { type: "vgroup", label: "Effect", items: e.ui }
                ]
            }];
        } else {
            r.ui = [{
                type: "tgroup", label: "Polyphonic", items: [
                    { type: "vgroup", label: "Voices", items: o.ui }
                ]
            }];
        }
        return r as FaustDspMeta;
    }

    getJSON() {
        return JSON.stringify(this.getMeta());
    }

    getUI() {
        return this.getMeta().ui;
    }

    getDescriptors() { return this.fDescriptor; }

    midiMessage(data: number[] | Uint8Array) {
        const cmd = data[0] >> 4;
        const channel = data[0] & 0xf;
        const data1 = data[1];
        const data2 = data[2];
        if (cmd === 8 || (cmd === 9 && data2 === 0)) return this.keyOff(channel, data1, data2);
        else if (cmd === 9) return this.keyOn(channel, data1, data2);
        else super.midiMessage(data);
    };

    ctrlChange(channel: number, ctrl: number, value: number) {
        if (ctrl === 123 || ctrl === 120) {
            this.allNotesOff(true);
        } else {
            super.ctrlChange(channel, ctrl, value);
        }
    }

    keyOn(channel: number, pitch: number, velocity: number) {
        if (this.fPlotHandler) this.fCachedEvents.push({ type: "keyOn", data: [channel, pitch, velocity] });
        const voice = this.getFreeVoice();
        this.fVoiceTable[voice].keyOn(pitch, velocity, this.fVoiceTable[voice].fCurNote == FaustWebAudioDspVoice.kLegatoVoice);
    }

    keyOff(channel: number, pitch: number, velocity: number) {
        if (this.fPlotHandler) this.fCachedEvents.push({ type: "keyOff", data: [channel, pitch, velocity] });
        const voice = this.getPlayingVoice(pitch);
        if (voice !== FaustWebAudioDspVoice.kNoVoice) {
            this.fVoiceTable[voice].keyOff();
        } else {
            console.log("Playing pitch = %d not found\n", pitch);
        }
    }

    allNotesOff(hard: boolean = true) {
        this.fCachedEvents.push({ type: "ctrlChange", data: [0, 123, 0] });
        this.fVoiceTable.forEach(voice => voice.keyOff(hard));
    }
}
