import type { FaustMonoDspInstance, FaustPolyDspInstance, IFaustDspInstance } from "./FaustDspInstance";
import type { AudioData, FaustDspMeta, FaustUIDescriptor, FaustUIGroup, FaustUIInputItem, FaustUIItem, LooseFaustDspFactory } from "./types";

// Public API
export type OutputParamHandler = (path: string, value: number) => void;
export type ComputeHandler = (buffer_size: number) => void;
export type PlotHandler = (plotted: Float32Array[] | Float64Array[], index: number, events?: { type: string; data: any }[]) => void;
export type MetadataHandler = (key: string, value: string) => void;

// Implementation API
export type UIHandler = (item: FaustUIItem) => void;

/** Definition of the AudioBufferItem type */
export interface AudioBufferItem {
    pathName: string;
    audioBuffer: AudioBuffer;
};

/** Definition of the SoundfileItem type */
export interface SoundfileItem {
    /** Name of the soundfile */
    name: string;
    /** URL of the soundfile */
    url: string;
    /** Index in the DSP struct */
    index: number;
    /** Base pointer in wasm memory */
    basePtr: number;
};

/**
 * WasmAllocator is a basic memory management class designed to allocate
 * blocks of memory within a WebAssembly.Memory object. It provides a simple
 * alloc method to allocate a contiguous block of memory of a specified size.
 * 
 * The allocator operates by keeping a linear progression through the memory,
 * always allocating the next block at the end of the last. This approach does not
 * handle freeing of memory or reuse of memory spaces.
 */
export class WasmAllocator {
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
     * Returns the Int64 view of the underlying buffer object.
     * 
     * @returns The view of the memory buffer as BigInt64Array.
     */
    getInt64Array(): BigInt64Array {
        return new BigInt64Array(this.memory.buffer);
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

/**
 * Soundfile class to handle soundfile data in wasm memory.
 */
export class Soundfile {
    /** Maximum number of soundfile parts. */
    static get MAX_SOUNDFILE_PARTS() { return 256; }
    
    /** Maximum number of channels. */
    static get MAX_CHAN() { return 64; }
    
    /** Maximum buffer size in frames. */
    static get BUFFER_SIZE() { return 1024; }
    
    /** Default sample rate. */
    static get SAMPLE_RATE() { return 44100; }
    
    /** Pointer to the soundfile structure in wasm memory */
    private readonly fPtr: number;
    private readonly fBuffers: number;
    private readonly fLength: number;
    private readonly fSR: number;
    private readonly fOffset: number;
    private readonly fSampleSize: number;
    private readonly fPtrSize: number;
    private readonly fIntSize: number;
    private readonly fAllocator: WasmAllocator;

    constructor(allocator: WasmAllocator, sampleSize: number, curChan: number, length: number, maxChan: number, totalParts: number) {

        this.fSampleSize = sampleSize;

        // To be coherent with the code generated by the wast/wasm backends:
        // - that uses 4 bytes for int when float is used
        // - that uses 8 bytes for int when double is used (to simplify the code generation)
        this.fIntSize = this.fSampleSize;

        this.fPtrSize = 4;  // Not related to float/double choice, so always 4

        this.fAllocator = allocator;

        console.log(`Soundfile constructor: curChan: ${curChan}, length: ${length}, maxChan: ${maxChan}, totalParts: ${totalParts}`);

        // Allocate wasm memory for the soundfile structure
        this.fPtr = allocator.alloc(4 * this.fPtrSize); // 4 fPtrSize: fBuffers, fLength, fSR, fOffset

        // Use the 4 or 8 bytes size for int. The access are then adapted in copyToOut and emptyFile methods
        this.fLength = allocator.alloc(Soundfile.MAX_SOUNDFILE_PARTS * this.fIntSize);
        this.fSR = allocator.alloc(Soundfile.MAX_SOUNDFILE_PARTS * this.fIntSize);
        this.fOffset = allocator.alloc(Soundfile.MAX_SOUNDFILE_PARTS * this.fIntSize);

        this.fBuffers = this.allocBuffers(curChan, length, maxChan);

        //this.displayMemory("Allocated soundfile structure 1");

        // Set the soundfile structure in wasm memory
        const HEAP32 = this.fAllocator.getInt32Array();
        HEAP32[this.fPtr >> 2] = this.fBuffers;
        HEAP32[(this.fPtr + this.fPtrSize) >> 2] = this.fLength;
        HEAP32[(this.fPtr + (2 * this.fPtrSize)) >> 2] = this.fSR;
        HEAP32[(this.fPtr + (3 * this.fPtrSize)) >> 2] = this.fOffset;

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

    copyToOut(part: number, maxChannels: number, offset: number, audioData: AudioData) {
        // Set the soundfile fields in wasm memory
        if (this.fIntSize === 4) {
            const HEAP32 = this.fAllocator.getInt32Array();
            HEAP32[(this.fLength >> Math.log2(this.fIntSize)) + part] = audioData.audioBuffer[0].length;
            HEAP32[(this.fSR >> Math.log2(this.fIntSize)) + part] = audioData.sampleRate;
            HEAP32[(this.fOffset >> Math.log2(this.fIntSize)) + part] = offset;
        } else {
            const HEAP64 = this.fAllocator.getInt64Array();
            HEAP64[(this.fLength >> Math.log2(this.fIntSize)) + part] = BigInt(audioData.audioBuffer[0].length);
            HEAP64[(this.fSR >> Math.log2(this.fIntSize)) + part] = BigInt(audioData.sampleRate);
            HEAP64[(this.fOffset >> Math.log2(this.fIntSize)) + part] = BigInt(offset);
        }

        console.log(`copyToOut: part: ${part}, maxChannels: ${maxChannels}, offset: ${offset}, buffer: ${audioData}`);

        //this.displayMemory("IN copyToOut, BEFORE copyToOutReal", true);
        // Copy the soundfile data to the buffer
        if (this.fSampleSize === 8) {
            this.copyToOutReal64(maxChannels, offset, audioData);
        } else {
            this.copyToOutReal32(maxChannels, offset, audioData);
        }
        //this.displayMemory("IN copyToOut, AFTER copyToOutReal");
    }

    copyToOutReal32(maxChannels: number, offset: number, audioData: AudioData) {
        const HEAP32 = this.fAllocator.getInt32Array();
        const HEAPF = this.fAllocator.getFloat32Array();
        for (let chan = 0; chan < audioData.audioBuffer.length; chan++) {
            const input: Float32Array = audioData.audioBuffer[chan];
            const output: number = HEAP32[(this.fBuffers >> 2) + chan];
            const begin: number = (output + (offset * this.fSampleSize)) >> Math.log2(this.fSampleSize);
            const end: number = (output + (offset + input.length) * this.fSampleSize) >> Math.log2(this.fSampleSize);
            console.log(`copyToOutReal32 begin: ${begin}, end: ${end}, delta: ${end - begin}`);
            const outputReal: Float32Array = HEAPF.subarray((output + (offset * this.fSampleSize)) >> Math.log2(this.fSampleSize),
                (output + (offset + input.length) * this.fSampleSize) >> Math.log2(this.fSampleSize));
            for (let sample = 0; sample < input.length; sample++) {
                outputReal[sample] = input[sample];
            }
        }
    }

    copyToOutReal64(maxChannels: number, offset: number, audioData: AudioData) {
        const HEAP32 = this.fAllocator.getInt32Array();
        const HEAPF = this.fAllocator.getFloat64Array();
        for (let chan = 0; chan < audioData.audioBuffer.length; chan++) {
            const input: Float32Array = audioData.audioBuffer[chan];
            const output: number = HEAP32[(this.fBuffers >> 2) + chan];
            const begin: number = (output + (offset * this.fSampleSize)) >> Math.log2(this.fSampleSize);
            const end: number = (output + (offset + input.length) * this.fSampleSize) >> Math.log2(this.fSampleSize);
            console.log(`copyToOutReal64 begin: ${begin}, end: ${end}, delta: ${end - begin}`);
            const outputReal: Float64Array = HEAPF.subarray((output + (offset * this.fSampleSize)) >> Math.log2(this.fSampleSize),
                (output + (offset + input.length) * this.fSampleSize) >> Math.log2(this.fSampleSize));
            for (let sample = 0; sample < input.length; sample++) {
                outputReal[sample] = input[sample];
            }
        }
    }

    emptyFile(part: number, offset: number): number {
        // Set the soundfile fields in wasm memory
        if (this.fIntSize === 4) {
            const HEAP32 = this.fAllocator.getInt32Array();
            HEAP32[(this.fLength >> Math.log2(this.fIntSize)) + part] = Soundfile.BUFFER_SIZE;
            HEAP32[(this.fSR >> Math.log2(this.fIntSize)) + part] = Soundfile.SAMPLE_RATE;
            HEAP32[(this.fOffset >> Math.log2(this.fIntSize)) + part] = offset;
        } else {
            const HEAP64 = this.fAllocator.getInt64Array();
            HEAP64[(this.fLength >> Math.log2(this.fIntSize)) + part] = BigInt(Soundfile.BUFFER_SIZE);
            HEAP64[(this.fSR >> Math.log2(this.fIntSize)) + part] = BigInt(Soundfile.SAMPLE_RATE);
            HEAP64[(this.fOffset >> Math.log2(this.fIntSize)) + part] = BigInt(offset);
        }

        // Update and return the new offset
        return offset + Soundfile.BUFFER_SIZE;
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

export class FaustBaseWebAudioDsp implements IFaustBaseWebAudioDsp {
    protected fOutputHandler: OutputParamHandler | null = null;
    protected fComputeHandler: ComputeHandler | null = null;

    // To handle MIDI events plot
    protected fPlotHandler: PlotHandler | null = null;
    protected fCachedEvents: { type: string; data: any }[] = [];
    protected fBufferNum = 0;

    protected fInChannels: Float32Array[] | Float64Array[] = [];
    protected fOutChannels: Float32Array[] | Float64Array[] = [];

    protected fOutputsTimer = 5;

    // UI items path
    protected fInputsItems: string[] = [];
    protected fOutputsItems: string[] = [];
    protected fDescriptor: FaustUIInputItem[] = [];

    // Soundfile handling
    protected fSoundfiles: SoundfileItem[] = [];
    protected fSoundfileBuffers: LooseFaustDspFactory["soundfiles"] = {};
    /** Keep the end of memory offset before soundfiles */
    protected fEndMemory: number;

    // Buffers in wasm memory
    protected fAudioInputs!: number;
    protected fAudioOutputs!: number;

    protected fBufferSize: number;
    protected fPtrSize: number;
    protected fSampleSize: number;

    // MIDI handling
    protected fPitchwheelLabel: { path: string; min: number; max: number }[] = [];
    protected fCtrlLabel: { path: string; min: number; max: number }[][] = new Array(128).fill(null).map(() => []);
    protected fPathTable: { [address: string]: number } = {};
    protected fUICallback: UIHandler = (item: FaustUIItem) => {
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
            this.fSoundfiles.push({ name: item.label, url: item.url, index: item.index, basePtr: -1 });
        }
    };

    // Audio callback
    protected fProcessing = false;
    protected fDestroyed = false;
    protected fFirstCall = true;

    protected fJSONDsp!: FaustDspMeta;

    constructor(sampleSize: number, bufferSize: number, soundfiles: LooseFaustDspFactory["soundfiles"]) {
        this.fBufferSize = bufferSize;
        this.fPtrSize = sampleSize; // Done on wast/wasm backend side
        this.fSampleSize = sampleSize;
        this.fSoundfileBuffers = soundfiles;
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

    /** Split the soundfile names and return an array of names */
    static splitSoundfileNames(input: string): string[] {
        // Trim off the curly braces at the start and end, if present
        let trimmed = input.replace(/^\{|\}$/g, '');
        // Split the string into an array of strings and remove first and last characters
        return trimmed.split(";").map(str => str.length <= 2 ? '' : str.substring(1, str.length - 1));
    }

    static extractUrlsFromMeta(dspMeta: FaustDspMeta): string[] {
        // Find the entry with the "soundfiles" key
        const soundfilesEntry = dspMeta.meta.find(entry => entry.soundfiles !== undefined);
        // If the entry is found, split the string by semicolon to get the URLs
        if (soundfilesEntry) {
            return soundfilesEntry.soundfiles.split(";").filter(url => url !== "");
        } else {
            return [];
        }
    }

    /**
     * Load a soundfile possibly containing several parts in the DSP struct.
     * Soundfile pointers are located at 'index' offset, to be read in the JSON file.
     * The DSP struct is located at baseDSP in the wasm memory, 
     * either a monophonic DSP, or a voice in a polyphonic context.
     * 
     * @param allocator : the wasm memory allocator
     * @param baseDSP : the base DSP in the wasm memory
     * @param name : the name of the soundfile
     * @param url : the url of the soundfile
     */
    private loadSoundfile(allocator: WasmAllocator, baseDSP: number, name: string, url: string) {
        console.log(`Soundfile ${name} paths: ${url}`);
        const soundfileIds = FaustBaseWebAudioDsp.splitSoundfileNames(url);
        const item = this.fSoundfiles.find(item => item.url === url);
        if (!item) throw new Error(`Soundfile with ${url} cannot be found !}`);
        // Use the cached Soundfile
        if (item.basePtr !== -1) {
            // Update HEAP32 after soundfile creation
            const HEAP32 = allocator.getInt32Array();
            // Fill the soundfile structure in wasm memory, soundfiles are at the beginning of the DSP memory
            console.log(`Soundfile CACHE ${url}} : ${name} loaded at ${item.basePtr} in wasm memory with index ${item.index}`);
            // Soundfile is located at 'index' in the DSP struct, to be added with baseDSP in the wasm memory
            HEAP32[(baseDSP + item.index) >> 2] = item.basePtr;
        } else {
            // Create the soundfiles
            const soundfile = this.createSoundfile(allocator, soundfileIds, this.fSoundfileBuffers);
            if (soundfile) {
                // Update HEAP32 after soundfile creation
                const HEAP32 = soundfile.getHEAP32();
                // Get the soundfile pointer in wasm memory
                item.basePtr = soundfile.getPtr();
                console.log(`Soundfile ${name} loaded at ${item.basePtr} in wasm memory with index ${item.index}`);
                // Soundfile is located at 'index' in the DSP struct, to be added with baseDSP in the wasm memory
                HEAP32[(baseDSP + item.index) >> 2] = item.basePtr;
            } else {
                console.log(`Soundfile ${name} for ${url} cannot be created !}`);
            }
        }
    }

    createSoundfile(allocator: WasmAllocator, soundfileIdList: string[], soundfiles: LooseFaustDspFactory["soundfiles"], maxChan = Soundfile.MAX_CHAN) {
        let curChan = 1; // At least one channel
        let totalLength = 0;

        // Compute total length and channels max of all files
        for (const soundfileId of soundfileIdList) {
            let chan = 0;
            let len = 0;
            const audioData = soundfiles[soundfileId];
            if (audioData) {
                chan = audioData.audioBuffer.length;
                len = audioData.audioBuffer[0].length;
            } else {
                len = Soundfile.BUFFER_SIZE;
                chan = 1;
            }
            curChan = Math.max(curChan, chan);
            totalLength += len;
        }

        // Complete with empty parts
        totalLength += (Soundfile.MAX_SOUNDFILE_PARTS - soundfileIdList.length) * Soundfile.BUFFER_SIZE;

        // Create the soundfile
        const soundfile = new Soundfile(allocator, this.fSampleSize, curChan, totalLength, maxChan, soundfileIdList.length);

        //soundfile.displayMemory("After soundfile creation");
        // Init offset
        let offset = 0;

        // Read all files
        for (let part = 0; part < soundfileIdList.length; part++) {
            const soundfileId = soundfileIdList[part];
            const audioData = soundfiles[soundfileId];
            if (audioData) {
                //soundfile.displayMemory("BEFORE copyToOut");
                soundfile.copyToOut(part, maxChan, offset, audioData);
                //soundfile.displayMemory("AFTER copyToOut");
                offset += audioData.audioBuffer[0].length;
            } else {
                // Empty sound
                offset = soundfile.emptyFile(part, offset);
            }
        }

        //soundfile.displayMemory("After reading soundfiles");

        // Complete with empty parts
        for (let part = soundfileIdList.length; part < Soundfile.MAX_SOUNDFILE_PARTS; part++) {
            offset = soundfile.emptyFile(part, offset);
        }

        //soundfile.displayMemory("After emptyFile");

        // Share the same buffers for all other channels so that we have maxChan channels available
        soundfile.shareBuffers(curChan, maxChan);

        //soundfile.displayMemory("After shareBuffers");

        return soundfile;
    }
    /** 
     * Init soundfiles memory.
     * 
     * @param allocator : the wasm memory allocator
     * @param sfReader : the soundfile reader
     * @param baseDSP : the DSP struct (either a monophonic DSP of polyphonic voice) base DSP in the wasm memory
    */
    protected initSoundfileMemory(allocator: WasmAllocator, baseDSP: number) {
        // Create and fill the soundfile structure
        for (const { name, url } of this.fSoundfiles) {
            this.loadSoundfile(allocator, baseDSP, name, url);
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

    constructor(instance: FaustMonoDspInstance, sampleRate: number, sampleSize: number, bufferSize: number, soundfiles: LooseFaustDspFactory["soundfiles"]) {

        super(sampleSize, bufferSize, soundfiles);
        this.fInstance = instance;

        console.log(`sampleSize: ${sampleSize} bufferSize: ${bufferSize}`);

        // Create JSON object
        this.fJSONDsp = JSON.parse(this.fInstance.json);

        // Setup GUI
        FaustBaseWebAudioDsp.parseUI(this.fJSONDsp.ui, this.fUICallback);

        // Setup wasm memory
        this.fEndMemory = this.initMemory();

        // Init DSP
        this.fInstance.api.init(this.fDSP, sampleRate);

        // Init soundfiles memory is needed
        if (this.fSoundfiles.length > 0) {

            // Create memory allocator for soundfiles in wasm memory, starting at the end of DSP memory
            const allocator = new WasmAllocator(this.fInstance.memory, this.fEndMemory);

            // Init soundfiles memory
            this.initSoundfileMemory(allocator, this.fDSP);
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
                // console.log("chan: " + chan + " output: " + dspOutput[0]);
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
    // Voice state
    static get kActiveVoice() { return 0; }
    static get kFreeVoice() { return -1; }
    static get kReleaseVoice() { return -2; }
    static get kLegatoVoice() { return -3; }
    static get kNoVoice() { return -4; }
    static get VOICE_STOP_LEVEL() { return 0.0005; }

    private fFreqLabel: number[] = [];
    private fGateLabel: number[] = [];
    private fGainLabel: number[] = [];
    private fKeyLabel: number[] = [];
    private fVelLabel: number[] = [];
    private fDSP: number;            // Voice DSP location in wasm memory
    private fAPI: IFaustDspInstance; // Voice DSP code
    // Accessed by PolyDSPImp class
    fCurNote = FaustWebAudioDspVoice.kFreeVoice;
    fNextNote = -1;
    fNextVel = -1;
    fDate = 0;
    fLevel = 0;
    fRelease = 0;

    constructor($dsp: number, api: IFaustDspInstance, inputItems: string[], pathTable: { [address: string]: number }, sampleRate: number) {
        this.fDSP = $dsp;
        this.fAPI = api;
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

    constructor(instance: FaustPolyDspInstance, sampleRate: number, sampleSize: number, bufferSize: number, soundfiles: LooseFaustDspFactory["soundfiles"]) {
        super(sampleSize, bufferSize, soundfiles);
        this.fInstance = instance;

        console.log(`sampleSize: ${sampleSize} bufferSize: ${bufferSize}`);

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

        // Init soundfiles memory is needed
        if (this.fSoundfiles.length > 0) {
            // Create memory allocator for soundfiles in wasm memory, starting at the end of DSP memory
            const allocator = new WasmAllocator(this.fInstance.memory, this.fEndMemory);
            // Init soundfiles memory for all voices
            for (let voice = 0; voice < this.fInstance.voices; voice++) {
                this.initSoundfileMemory(allocator, this.fJSONDsp.size * voice);
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
