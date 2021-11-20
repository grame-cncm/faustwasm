/// <reference types="emscripten" />
declare module "FaustDspInstance" {
    export interface IFaustDspInstance {
        compute($dsp: number, count: number, $inputs: number, $output: number): void;
        getNumInputs($dsp: number): number;
        getNumOutputs($dsp: number): number;
        getParamValue($dsp: number, index: number): number;
        getSampleRate($dsp: number): number;
        init($dsp: number, sampleRate: number): void;
        instanceClear($dsp: number): void;
        instanceConstants($dsp: number, sampleRate: number): void;
        instanceInit($dsp: number, sampleRate: number): void;
        instanceResetUserInterface($dsp: number): void;
        setParamValue($dsp: number, index: number, value: number): void;
    }
    export interface IFaustMixerInstance {
        clearOutput(bufferSize: number, chans: number, $outputs: number): void;
        mixCheckVoice(bufferSize: number, chans: number, $inputs: number, $outputs: number): number;
        fadeOut(bufferSize: number, chans: number, $outputs: number): void;
    }
    export interface FaustMonoDspInstance {
        memory: WebAssembly.Memory;
        api: IFaustDspInstance;
        json: string;
    }
    export interface FaustPolyDspInstance {
        memory: WebAssembly.Memory;
        voices: number;
        voiceAPI: IFaustDspInstance;
        effectAPI?: IFaustDspInstance;
        mixerAPI: IFaustMixerInstance;
        voiceJSON: string;
        effectJSON?: string;
    }
    class FaustDspInstance implements IFaustDspInstance {
        private readonly fExports;
        constructor(exports: IFaustDspInstance);
        compute($dsp: number, count: number, $input: number, $output: number): void;
        getNumInputs($dsp: number): number;
        getNumOutputs($dsp: number): number;
        getParamValue($dsp: number, index: number): number;
        getSampleRate($dsp: number): number;
        init($dsp: number, sampleRate: number): void;
        instanceClear($dsp: number): void;
        instanceConstants($dsp: number, sampleRate: number): void;
        instanceInit($dsp: number, sampleRate: number): void;
        instanceResetUserInterface($dsp: number): void;
        setParamValue($dsp: number, index: number, value: number): void;
    }
    export default FaustDspInstance;
}
declare module "types" {
    export type FaustModuleFactory = EmscriptenModuleFactory<FaustModule>;
    export interface FaustModule extends EmscriptenModule {
        ccall: typeof ccall;
        cwrap: typeof cwrap;
        UTF8ArrayToString(u8Array: number[], ptr: number, maxBytesToRead?: number): string;
        stringToUTF8Array(str: string, outU8Array: number[], outIdx: number, maxBytesToWrite: number): number;
        UTF8ToString: typeof UTF8ToString;
        UTF16ToString: typeof UTF16ToString;
        UTF32ToString: typeof UTF32ToString;
        stringToUTF8: typeof stringToUTF8;
        stringToUTF16: typeof stringToUTF16;
        stringToUTF32: typeof stringToUTF32;
        allocateUTF8: typeof allocateUTF8;
        lengthBytesUTF8: typeof lengthBytesUTF8;
        lengthBytesUTF16: typeof lengthBytesUTF16;
        lengthBytesUTF32: typeof lengthBytesUTF32;
        FS: typeof FS;
        libFaustWasm: new () => LibFaustWasm;
    }
    export type TFaustInfoType = "help" | "version" | "libdir" | "includedir" | "archdir" | "dspdir" | "pathslist";
    export interface IntVector {
        size(): number;
        get(i: number): number;
    }
    export interface FaustWasm {
        cfactory: number;
        data: IntVector;
        json: string;
    }
    export interface LibFaustWasm {
        version(): string;
        createDSPFactory(name: string, code: string, args: string, useInternalMemory: boolean): FaustWasm;
        deleteDSPFactory(cFactory: number): void;
        expandDSP(name: string, code: string, args: string): string;
        generateAuxFiles(name: string, code: string, args: string): boolean;
        deleteAllDSPFactories(): void;
        getErrorAfterException(): string;
        cleanupAfterException(): void;
        getInfos(what: TFaustInfoType): string;
    }
    export interface FaustDspFactory extends Required<LooseFaustDspFactory> {
    }
    export interface LooseFaustDspFactory {
        cfactory?: number;
        code?: Uint8Array;
        module: WebAssembly.Module;
        json: string;
        poly?: boolean;
    }
    export interface FaustDspMeta {
        name: string;
        filename: string;
        compile_options: string;
        include_pathnames: string[];
        inputs: number;
        outputs: number;
        size: number;
        version: string;
        library_list: string[];
        meta: {
            [key: string]: string;
        }[];
        ui: FaustUIDescriptor;
    }
    export type FaustUIDescriptor = IFaustUIGroup[];
    export type IFaustUIItem = IFaustUIInputItem | IFaustUIOutputItem | IFaustUIGroup;
    export interface IFaustUIInputItem {
        type: FaustUIInputType;
        label: string;
        address: string;
        index: number;
        init?: number;
        min?: number;
        max?: number;
        step?: number;
        meta?: IFaustUIMeta[];
    }
    export interface IFaustUIOutputItem {
        type: FaustUIOutputType;
        label: string;
        address: string;
        index: number;
        min?: number;
        max?: number;
        meta?: IFaustUIMeta[];
    }
    export interface IFaustUIMeta {
        [order: number]: string;
        style?: string;
        unit?: string;
        scale?: "linear" | "exp" | "log";
        tooltip?: string;
        hidden?: string;
        [key: string]: string | undefined;
    }
    export type FaustUIGroupType = "vgroup" | "hgroup" | "tgroup";
    export type FaustUIOutputType = "hbargraph" | "vbargraph";
    export type FaustUIInputType = "vslider" | "hslider" | "button" | "checkbox" | "nentry";
    export interface IFaustUIGroup {
        type: FaustUIGroupType;
        label: string;
        items: IFaustUIItem[];
    }
    export type FaustUIType = FaustUIGroupType | FaustUIOutputType | FaustUIInputType;
    export interface AudioParamDescriptor {
        automationRate?: AutomationRate;
        defaultValue?: number;
        maxValue?: number;
        minValue?: number;
        name: string;
    }
    export interface AudioWorkletProcessor {
        port: MessagePort;
        process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
    }
    export const AudioWorkletProcessor: {
        prototype: AudioWorkletProcessor;
        parameterDescriptors: AudioParamDescriptor[];
        new (options: AudioWorkletNodeOptions): AudioWorkletProcessor;
    };
    export interface AudioWorkletGlobalScope {
        AudioWorkletGlobalScope: any;
        globalThis: AudioWorkletGlobalScope;
        registerProcessor: (name: string, constructor: new (options: any) => AudioWorkletProcessor) => void;
        currentFrame: number;
        currentTime: number;
        sampleRate: number;
        AudioWorkletProcessor: typeof AudioWorkletProcessor;
    }
}
declare module "FaustWebAudioDsp" {
    import type { FaustMonoDspInstance, FaustPolyDspInstance, IFaustDspInstance } from "FaustDspInstance";
    import type { FaustDspMeta, FaustUIDescriptor, IFaustUIGroup, IFaustUIInputItem, IFaustUIItem } from "types";
    export type OutputParamHandler = (path: string, value: number) => void;
    export type ComputeHandler = (buffer_size: number) => void;
    export type PlotHandler = (plotted: Float32Array[], index: number, events?: {
        type: string;
        data: any;
    }[]) => void;
    export type MetadataHandler = (key: string, value: string) => void;
    export type UIHandler = (item: IFaustUIItem) => void;
    export interface IFaustBaseWebAudioDsp {
        setOutputParamHandler(handler: OutputParamHandler | null): void;
        getOutputParamHandler(): OutputParamHandler | null;
        setComputeHandler(handler: ComputeHandler | null): void;
        getComputeHandler(): ComputeHandler | null;
        setPlotHandler(handler: PlotHandler | null): void;
        getPlotHandler(): PlotHandler | null;
        getNumInputs(): number;
        getNumOutputs(): number;
        compute(inputs: Float32Array[], outputs: Float32Array[]): boolean;
        metadata(handler: MetadataHandler): void;
        midiMessage(data: number[] | Uint8Array): void;
        ctrlChange(chan: number, ctrl: number, value: number): void;
        pitchWheel(chan: number, value: number): void;
        setParamValue(path: string, value: number): void;
        getParamValue(path: string): number;
        getParams(): string[];
        getMeta(): FaustDspMeta;
        getJSON(): string;
        getUI(): FaustUIDescriptor;
        getDescriptors(): IFaustUIInputItem[];
        start(): void;
        stop(): void;
        destroy(): void;
    }
    export interface IFaustMonoWebAudioDsp extends IFaustBaseWebAudioDsp {
    }
    export interface IFaustMonoWebAudioNode extends IFaustMonoWebAudioDsp, AudioNode {
    }
    export interface IFaustPolyWebAudioDsp extends IFaustBaseWebAudioDsp {
        keyOn(channel: number, pitch: number, velocity: number): void;
        keyOff(channel: number, pitch: number, velocity: number): void;
        allNotesOff(hard: boolean): void;
    }
    export interface IFaustPolyWebAudioNode extends IFaustPolyWebAudioDsp, AudioNode {
    }
    export class FaustBaseWebAudioDsp implements IFaustBaseWebAudioDsp {
        protected fOutputHandler: OutputParamHandler | null;
        protected fComputeHandler: ComputeHandler | null;
        protected fPlotHandler: PlotHandler | null;
        protected fCachedEvents: {
            type: string;
            data: any;
        }[];
        protected fBufferNum: number;
        protected fInChannels: Float32Array[] | Float64Array[];
        protected fOutChannels: Float32Array[] | Float64Array[];
        protected fOutputsTimer: number;
        protected fInputsItems: string[];
        protected fOutputsItems: string[];
        protected fDescriptor: IFaustUIInputItem[];
        protected fAudioInputs: number;
        protected fAudioOutputs: number;
        protected fBufferSize: number;
        protected gPtrSize: number;
        protected gSampleSize: number;
        protected fPitchwheelLabel: {
            path: string;
            min: number;
            max: number;
        }[];
        protected fCtrlLabel: {
            path: string;
            min: number;
            max: number;
        }[][];
        protected fPathTable: {
            [address: string]: number;
        };
        protected fUICallback: UIHandler;
        protected fProcessing: boolean;
        protected fDestroyed: boolean;
        protected fJSONDsp: FaustDspMeta;
        constructor(sampleSize: number, bufferSize: number);
        static remap(v: number, mn0: number, mx0: number, mn1: number, mx1: number): number;
        static parseUI(ui: FaustUIDescriptor, callback: (...args: any[]) => any): void;
        static parseGroup(group: IFaustUIGroup, callback: (...args: any[]) => any): void;
        static parseItems(items: IFaustUIItem[], callback: (...args: any[]) => any): void;
        static parseItem(item: IFaustUIItem, callback: (...args: any[]) => any): void;
        protected updateOutputs(): void;
        metadata(handler: MetadataHandler): void;
        compute(input: Float32Array[], output: Float32Array[]): boolean;
        setOutputParamHandler(handler: OutputParamHandler | null): void;
        getOutputParamHandler(): OutputParamHandler | null;
        setComputeHandler(handler: ComputeHandler | null): void;
        getComputeHandler(): ComputeHandler | null;
        setPlotHandler(handler: PlotHandler | null): void;
        getPlotHandler(): PlotHandler | null;
        getNumInputs(): number;
        getNumOutputs(): number;
        midiMessage(data: number[] | Uint8Array): void;
        ctrlChange(channel: number, ctrl: number, value: number): void;
        pitchWheel(channel: number, wheel: number): void;
        setParamValue(path: string, value: number): void;
        getParamValue(path: string): number;
        getParams(): string[];
        getMeta(): FaustDspMeta;
        getJSON(): string;
        getUI(): FaustUIDescriptor;
        getDescriptors(): IFaustUIInputItem[];
        start(): void;
        stop(): void;
        destroy(): void;
    }
    export class FaustMonoWebAudioDsp extends FaustBaseWebAudioDsp implements IFaustMonoWebAudioDsp {
        private fInstance;
        private fDSP;
        constructor(instance: FaustMonoDspInstance, sampleRate: number, sampleSize: number, bufferSize: number);
        private initMemory;
        toString(): string;
        compute(input: Float32Array[], output: Float32Array[]): boolean;
        metadata(handler: MetadataHandler): void;
        getNumInputs(): number;
        getNumOutputs(): number;
        setParamValue(path: string, value: number): void;
        getParamValue(path: string): number;
        getMeta(): FaustDspMeta;
        getJSON(): string;
        getDescriptors(): IFaustUIInputItem[];
        getUI(): FaustUIDescriptor;
    }
    export class FaustWebAudioDspVoice {
        static kActiveVoice: number;
        static kFreeVoice: number;
        static kReleaseVoice: number;
        static kLegatoVoice: number;
        static kNoVoice: number;
        static VOICE_STOP_LEVEL: number;
        private fFreqLabel;
        private fGateLabel;
        private fGainLabel;
        private fDSP;
        private fAPI;
        private fKeyFun;
        private fVelFun;
        fCurNote: number;
        fNextNote: number;
        fNextVel: number;
        fDate: number;
        fLevel: number;
        fRelease: number;
        constructor($dsp: number, api: IFaustDspInstance, inputItems: string[], pathTable: {
            [address: string]: number;
        }, sampleRate: number);
        static midiToFreq(note: number): number;
        private extractPaths;
        keyOn(pitch: number, velocity: number, legato?: boolean): void;
        keyOff(hard?: boolean): void;
        computeLegato(bufferSize: number, $inputs: number, $outputZero: number, $outputsHalf: number): void;
        compute(bufferSize: number, $inputs: number, $outputs: number): void;
        setParamValue(index: number, value: number): void;
        getParamValue(index: number): number;
    }
    export class FaustPolyWebAudioDsp extends FaustBaseWebAudioDsp implements IFaustPolyWebAudioDsp {
        private fInstance;
        private fEffect;
        private fJSONEffect;
        private fAudioMixing;
        private fAudioMixingHalf;
        private fVoiceTable;
        constructor(instance: FaustPolyDspInstance, sampleRate: number, sampleSize: number, bufferSize: number);
        private initMemory;
        toString(): string;
        private allocVoice;
        private getPlayingVoice;
        private getFreeVoice;
        compute(input: Float32Array[], output: Float32Array[]): boolean;
        getNumInputs(): number;
        getNumOutputs(): number;
        private static findPath;
        setParamValue(path: string, value: number): void;
        getParamValue(path: string): number;
        getMeta(): FaustDspMeta;
        getJSON(): string;
        getUI(): FaustUIDescriptor;
        getDescriptors(): IFaustUIInputItem[];
        midiMessage(data: number[] | Uint8Array): void;
        ctrlChange(channel: number, ctrl: number, value: number): void;
        keyOn(channel: number, pitch: number, velocity: number): void;
        keyOff(channel: number, pitch: number, velocity: number): void;
        allNotesOff(hard?: boolean): void;
    }
}
declare module "FaustWasmInstantiator" {
    import { FaustMonoDspInstance, FaustPolyDspInstance } from "FaustDspInstance";
    import type { FaustDspFactory, LooseFaustDspFactory } from "types";
    class FaustWasmInstantiator {
        private static createWasmImport;
        private static createWasmMemory;
        private static createMonoDSPInstanceAux;
        private static createMemoryAux;
        private static createMixerAux;
        static loadDSPFactory(wasmPath: string, jsonPath: string): Promise<FaustDspFactory | null>;
        static loadDSPMixer(mixerPath: string, fs?: typeof FS): Promise<WebAssembly.Module | null>;
        static createAsyncMonoDSPInstance(factory: LooseFaustDspFactory): Promise<FaustMonoDspInstance>;
        static createSyncMonoDSPInstance(factory: LooseFaustDspFactory): FaustMonoDspInstance;
        static createAsyncPolyDSPInstance(voiceFactory: LooseFaustDspFactory, mixerModule: WebAssembly.Module, voices: number, effectFactory?: LooseFaustDspFactory): Promise<FaustPolyDspInstance>;
        static createSyncPolyDSPInstance(voiceFactory: LooseFaustDspFactory, mixerModule: WebAssembly.Module, voices: number, effectFactory?: LooseFaustDspFactory): FaustPolyDspInstance;
    }
    export default FaustWasmInstantiator;
}
declare module "FaustAudioWorkletProcessor" {
    import type FaustWasmInstantiator from "FaustWasmInstantiator";
    import type { FaustBaseWebAudioDsp, FaustWebAudioDspVoice, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp } from "FaustWebAudioDsp";
    import type { LooseFaustDspFactory, FaustDspMeta } from "types";
    export interface FaustData {
        dspName: string;
        dspMeta: FaustDspMeta;
        poly: boolean;
        effectMeta?: FaustDspMeta;
    }
    export interface FaustAudioWorkletProcessorDependencies<Poly extends boolean = false> {
        FaustBaseWebAudioDsp: typeof FaustBaseWebAudioDsp;
        FaustMonoWebAudioDsp: Poly extends true ? undefined : typeof FaustMonoWebAudioDsp;
        FaustPolyWebAudioDsp: Poly extends true ? typeof FaustPolyWebAudioDsp : undefined;
        FaustWebAudioDspVoice: Poly extends true ? undefined : typeof FaustWebAudioDspVoice;
        FaustWasmInstantiator: typeof FaustWasmInstantiator;
    }
    export interface FaustAudioWorkletNodeOptions<Poly extends boolean = false> extends AudioWorkletNodeOptions {
        processorOptions: Poly extends true ? FaustPolyAudioWorkletProcessorOptions : FaustMonoAudioWorkletProcessorOptions;
    }
    export interface FaustMonoAudioWorkletNodeOptions extends AudioWorkletNodeOptions {
        processorOptions: FaustMonoAudioWorkletProcessorOptions;
    }
    export interface FaustPolyAudioWorkletNodeOptions extends AudioWorkletNodeOptions {
        processorOptions: FaustPolyAudioWorkletProcessorOptions;
    }
    export interface FaustAudioWorkletProcessorOptions {
        name: string;
        sampleSize: number;
    }
    export interface FaustMonoAudioWorkletProcessorOptions extends FaustAudioWorkletProcessorOptions {
        factory: LooseFaustDspFactory;
    }
    export interface FaustPolyAudioWorkletProcessorOptions extends FaustAudioWorkletProcessorOptions {
        voiceFactory: LooseFaustDspFactory;
        mixerModule: WebAssembly.Module;
        voices: number;
        effectFactory?: LooseFaustDspFactory;
    }
    const getFaustAudioWorkletProcessor: <Poly extends boolean = false>(dependencies: FaustAudioWorkletProcessorDependencies<Poly>, faustData: FaustData) => void;
    export default getFaustAudioWorkletProcessor;
}
declare module "FaustAudioWorkletNode" {
    import { OutputParamHandler, ComputeHandler, PlotHandler, UIHandler, MetadataHandler, IFaustMonoWebAudioDsp, IFaustPolyWebAudioDsp } from "FaustWebAudioDsp";
    import type { FaustAudioWorkletNodeOptions } from "FaustAudioWorkletProcessor";
    import type { LooseFaustDspFactory, FaustDspMeta, IFaustUIInputItem } from "types";
    const FaustAudioWorkletNode_base: {
        new (context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions | undefined): AudioWorkletNode;
        prototype: AudioWorkletNode;
    };
    export class FaustAudioWorkletNode<Poly extends boolean = false> extends FaustAudioWorkletNode_base {
        protected fJSONDsp: FaustDspMeta;
        protected fJSON: string;
        protected fInputsItems: string[];
        protected fOutputHandler: OutputParamHandler | null;
        protected fComputeHandler: ComputeHandler | null;
        protected fPlotHandler: PlotHandler | null;
        protected fUICallback: UIHandler;
        protected fDescriptor: IFaustUIInputItem[];
        constructor(context: BaseAudioContext, name: string, factory: LooseFaustDspFactory, options: FaustAudioWorkletNodeOptions<Poly>["processorOptions"]);
        setOutputParamHandler(handler: OutputParamHandler | null): void;
        getOutputParamHandler(): OutputParamHandler | null;
        setComputeHandler(handler: ComputeHandler | null): void;
        getComputeHandler(): ComputeHandler | null;
        setPlotHandler(handler: PlotHandler | null): void;
        getPlotHandler(): PlotHandler | null;
        getNumInputs(): number;
        getNumOutputs(): number;
        compute(inputs: Float32Array[], outputs: Float32Array[]): boolean;
        metadata(handler: MetadataHandler): void;
        midiMessage(data: number[] | Uint8Array): void;
        ctrlChange(channel: number, ctrl: number, value: number): void;
        pitchWheel(channel: number, wheel: number): void;
        setParamValue(path: string, value: number): void;
        getParamValue(path: string): number;
        getParams(): string[];
        getMeta(): FaustDspMeta;
        getJSON(): string;
        getUI(): import("types").FaustUIDescriptor;
        getDescriptors(): IFaustUIInputItem[];
        start(): void;
        stop(): void;
        destroy(): void;
    }
    export class FaustMonoAudioWorkletNode extends FaustAudioWorkletNode<false> implements IFaustMonoWebAudioDsp {
        onprocessorerror: (e: Event) => never;
        constructor(context: BaseAudioContext, name: string, factory: LooseFaustDspFactory, sampleSize: number);
    }
    export class FaustPolyAudioWorkletNode extends FaustAudioWorkletNode<true> implements IFaustPolyWebAudioDsp {
        private fJSONEffect;
        onprocessorerror: (e: Event) => never;
        constructor(context: BaseAudioContext, name: string, voiceFactory: LooseFaustDspFactory, mixerModule: WebAssembly.Module, voices: number, sampleSize: number, effectFactory?: LooseFaustDspFactory);
        keyOn(channel: number, pitch: number, velocity: number): void;
        keyOff(channel: number, pitch: number, velocity: number): void;
        allNotesOff(hard: boolean): void;
        getMeta(): FaustDspMeta;
        getJSON(): string;
        getUI(): import("types").FaustUIDescriptor;
    }
}
declare module "LibFaust" {
    import type { FaustModule, LibFaustWasm, TFaustInfoType } from "types";
    export interface ILibFaust extends LibFaustWasm {
        module(): FaustModule;
        fs(): typeof FS;
    }
    class LibFaust implements ILibFaust {
        private fModule;
        private fCompiler;
        private fFileSystem;
        constructor(module: FaustModule);
        module(): FaustModule;
        fs(): typeof FS;
        version(): string;
        createDSPFactory(name: string, code: string, args: string, useInternalMemory: boolean): import("types").FaustWasm;
        deleteDSPFactory(cFactory: number): void;
        expandDSP(name: string, code: string, args: string): string;
        generateAuxFiles(name: string, code: string, args: string): boolean;
        deleteAllDSPFactories(): void;
        getErrorAfterException(): string;
        cleanupAfterException(): void;
        getInfos(what: TFaustInfoType): string;
        toString(): string;
    }
    export default LibFaust;
}
declare module "FaustCompiler" {
    import type { ILibFaust } from "LibFaust";
    import type { FaustDspFactory } from "types";
    export interface IFaustCompiler {
        version(): string;
        getErrorMessage(): string;
        createMonoDSPFactory(name: string, code: string, args: string): Promise<FaustDspFactory | null>;
        createPolyDSPFactory(name: string, code: string, args: string): Promise<FaustDspFactory | null>;
        deleteDSPFactory(factory: FaustDspFactory): void;
        expandDSP(code: string, args: string): string | null;
        generateAuxFiles(name: string, code: string, args: string): boolean;
        deleteAllDSPFactories(): void;
        fs(): typeof FS;
        getAsyncInternalMixerModule(isDouble?: boolean): Promise<{
            mixerBuffer: Uint8Array;
            mixerModule: WebAssembly.Module;
        }>;
        getSyncInternalMixerModule(isDouble?: boolean): {
            mixerBuffer: Uint8Array;
            mixerModule: WebAssembly.Module;
        };
    }
    class FaustCompiler implements IFaustCompiler {
        private fLibFaust;
        private fErrorMessage;
        private static gFactories;
        private mixer32Buffer;
        private mixer64Buffer;
        private mixer32Module;
        private mixer64Module;
        constructor(libFaust: ILibFaust);
        private intVec2intArray;
        private createDSPFactory;
        version(): string;
        getErrorMessage(): string;
        createMonoDSPFactory(name: string, code: string, args: string): Promise<FaustDspFactory | null>;
        createPolyDSPFactory(name: string, code: string, args: string): Promise<FaustDspFactory | null>;
        deleteDSPFactory(factory: FaustDspFactory): void;
        expandDSP(code: string, args: string): string | null;
        generateAuxFiles(name: string, code: string, args: string): boolean;
        deleteAllDSPFactories(): void;
        fs(): typeof FS;
        getAsyncInternalMixerModule(isDouble?: boolean): Promise<{
            mixerBuffer: Uint8Array;
            mixerModule: WebAssembly.Module;
        }>;
        getSyncInternalMixerModule(isDouble?: boolean): {
            mixerBuffer: Uint8Array;
            mixerModule: WebAssembly.Module;
        };
    }
    export default FaustCompiler;
}
declare module "FaustOfflineProcessor" {
    import type { IFaustMonoWebAudioDsp } from "FaustWebAudioDsp";
    export interface IFaustOfflineProcessor {
        render(inputs?: Float32Array[], length?: number, onUpdate?: (sample: number) => any): Float32Array[];
    }
    class FaustOfflineProcessor implements IFaustOfflineProcessor {
        private fDSPCode;
        private fBufferSize;
        private fInputs;
        private fOutputs;
        constructor(instance: IFaustMonoWebAudioDsp, bufferSize: number);
        render(inputs?: Float32Array[], length?: number, onUpdate?: (sample: number) => any): Float32Array[];
    }
    export default FaustOfflineProcessor;
}
declare module "FaustScriptProcessorNode" {
    import type { ComputeHandler, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp, MetadataHandler, OutputParamHandler, PlotHandler } from "FaustWebAudioDsp";
    const FaustScriptProcessorNode_base: {
        new (): ScriptProcessorNode;
        prototype: ScriptProcessorNode;
    };
    export class FaustScriptProcessorNode<Poly extends boolean = false> extends FaustScriptProcessorNode_base {
        protected fDSPCode: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp;
        protected fInputs: Float32Array[];
        protected fOutputs: Float32Array[];
        init(instance: Poly extends true ? FaustPolyWebAudioDsp : FaustMonoWebAudioDsp): void;
        compute(input: Float32Array[], output: Float32Array[]): boolean;
        setOutputParamHandler(handler: OutputParamHandler): void;
        getOutputParamHandler(): OutputParamHandler | null;
        setComputeHandler(handler: ComputeHandler): void;
        getComputeHandler(): ComputeHandler | null;
        setPlotHandler(handler: PlotHandler): void;
        getPlotHandler(): PlotHandler | null;
        getNumInputs(): number;
        getNumOutputs(): number;
        metadata(handler: MetadataHandler): void;
        midiMessage(data: number[] | Uint8Array): void;
        ctrlChange(chan: number, ctrl: number, value: number): void;
        pitchWheel(chan: number, value: number): void;
        setParamValue(path: string, value: number): void;
        getParamValue(path: string): number;
        getParams(): string[];
        getMeta(): import("types").FaustDspMeta;
        getJSON(): string;
        getDescriptors(): import("types").IFaustUIInputItem[];
        getUI(): import("types").FaustUIDescriptor;
        start(): void;
        stop(): void;
        destroy(): void;
    }
    export class FaustMonoScriptProcessorNode extends FaustScriptProcessorNode<false> {
    }
    export class FaustPolyScriptProcessorNode extends FaustScriptProcessorNode<true> {
        keyOn(channel: number, pitch: number, velocity: number): void;
        keyOff(channel: number, pitch: number, velocity: number): void;
        allNotesOff(hard: boolean): void;
    }
}
declare module "FaustDspGenerator" {
    import { FaustMonoAudioWorkletNode, FaustPolyAudioWorkletNode } from "FaustAudioWorkletNode";
    import { IFaustOfflineProcessor } from "FaustOfflineProcessor";
    import { FaustMonoScriptProcessorNode, FaustPolyScriptProcessorNode } from "FaustScriptProcessorNode";
    import { IFaustMonoWebAudioNode, IFaustPolyWebAudioNode } from "FaustWebAudioDsp";
    import type { IFaustCompiler } from "FaustCompiler";
    import type { FaustDspFactory, FaustDspMeta, LooseFaustDspFactory } from "types";
    export interface IFaustMonoDspGenerator {
        compile(compiler: IFaustCompiler, name: string, code: string, args: string): Promise<{
            factory: FaustDspFactory | null;
            name?: string;
            meta?: FaustDspMeta;
        } | null>;
        createNode(context: BaseAudioContext, name?: string, factory?: LooseFaustDspFactory, sp?: boolean, bufferSize?: number): Promise<IFaustMonoWebAudioNode | null>;
        createOfflineProcessor(sampleRate: number, bufferSize: number, factory?: LooseFaustDspFactory, meta?: FaustDspMeta): Promise<IFaustOfflineProcessor | null>;
    }
    export interface IFaustPolyDspGenerator {
        compile(compiler: IFaustCompiler, name: string, dspCode: string, args: string, effectCode?: string): Promise<{
            voiceFactory: FaustDspFactory | null;
            effectFactory?: FaustDspFactory | null;
        } | null>;
        createNode(context: BaseAudioContext, voices: number, name?: string, voiceFactory?: LooseFaustDspFactory, mixerModule?: WebAssembly.Module, effectFactory?: LooseFaustDspFactory | null, sp?: boolean, bufferSize?: number): Promise<IFaustPolyWebAudioNode | null>;
    }
    export class FaustMonoDspGenerator implements IFaustMonoDspGenerator {
        private static gWorkletProcessors;
        name: string;
        factory: FaustDspFactory | null;
        constructor();
        compile(compiler: IFaustCompiler, name: string, code: string, args: string): Promise<this | null>;
        createNode<SP extends boolean = false>(context: BaseAudioContext, name?: string, factory?: LooseFaustDspFactory, sp?: SP, bufferSize?: number): Promise<SP extends true ? FaustMonoScriptProcessorNode | null : FaustMonoAudioWorkletNode | null>;
        createOfflineProcessor(sampleRate: number, bufferSize: number, factory?: LooseFaustDspFactory): Promise<IFaustOfflineProcessor | null>;
    }
    export class FaustPolyDspGenerator implements IFaustPolyDspGenerator {
        private static gWorkletProcessors;
        name: string;
        voiceFactory: FaustDspFactory | null;
        effectFactory: FaustDspFactory | null;
        mixerBuffer: Uint8Array;
        mixerModule: WebAssembly.Module;
        constructor();
        compile(compiler: IFaustCompiler, name: string, dspCode: string, args: string, effectCode?: string): Promise<this | null>;
        createNode<SP extends boolean = false>(context: BaseAudioContext, voices: number, name?: string, voiceFactory?: LooseFaustDspFactory, mixerModule?: WebAssembly.Module, effectFactory?: LooseFaustDspFactory | null, sp?: SP, bufferSize?: number): Promise<SP extends true ? FaustPolyScriptProcessorNode | null : FaustPolyAudioWorkletNode | null>;
    }
}
declare module "FaustSvgDiagrams" {
    import FaustCompiler from "FaustCompiler";
    interface IFaustSvgDiagrams {
        from(name: string, code: string, args: string): Record<string, string>;
    }
    class FaustSvgDiagrams implements IFaustSvgDiagrams {
        private compiler;
        constructor(compiler: FaustCompiler);
        from(name: string, code: string, args: string): Record<string, string>;
    }
    export default FaustSvgDiagrams;
}
declare module "WavDecoder" {
    export interface WavDecoderOptions {
        symmetric?: boolean;
        shared?: boolean;
    }
    class WavDecoder {
        static decode(buffer: ArrayBuffer, options?: WavDecoderOptions): {
            numberOfChannels: number;
            length: number;
            sampleRate: number;
            channelData: Float32Array[];
        };
        private static decodeFormat;
        private static decodeData;
        private static readPCM;
    }
    export default WavDecoder;
}
declare module "WavEncoder" {
    export interface WavEncoderOptions {
        bitDepth: number;
        float?: boolean;
        symmetric?: boolean;
        shared?: boolean;
        sampleRate: number;
    }
    class WavEncoder {
        static encode(audioBuffer: Float32Array[], options: WavEncoderOptions): ArrayBuffer;
        private static writeHeader;
        private static writeData;
    }
    export default WavEncoder;
}
declare module "fetchModule" {
    const fetchModule: (url: string) => Promise<any>;
    export default fetchModule;
}
declare module "instantiateFaustModule" {
    const instantiateFaustModule: (jsFile: string, dataFile?: string, wasmFile?: string) => Promise<import("types").FaustModule>;
    export default instantiateFaustModule;
}
declare module "index" {
    import instantiateFaustModule from "instantiateFaustModule";
    import getFaustAudioWorkletProcessor from "FaustAudioWorkletProcessor";
    import FaustCompiler from "FaustCompiler";
    import FaustDspInstance from "FaustDspInstance";
    import FaustWasmInstantiator from "FaustWasmInstantiator";
    import FaustOfflineProcessor from "FaustOfflineProcessor";
    import FaustSvgDiagrams from "FaustSvgDiagrams";
    import LibFaust from "LibFaust";
    import WavEncoder from "WavEncoder";
    import WavDecoder from "WavDecoder";
    export * from "FaustAudioWorkletNode";
    export * from "FaustAudioWorkletProcessor";
    export * from "FaustCompiler";
    export * from "FaustDspInstance";
    export * from "FaustOfflineProcessor";
    export * from "FaustScriptProcessorNode";
    export * from "FaustWebAudioDsp";
    export * from "FaustDspGenerator";
    export * from "LibFaust";
    export { instantiateFaustModule, getFaustAudioWorkletProcessor, FaustDspInstance, FaustCompiler, FaustWasmInstantiator, FaustOfflineProcessor, FaustSvgDiagrams, LibFaust, WavEncoder, WavDecoder, };
    const _default: {
        instantiateFaustModule: (jsFile: string, dataFile?: string, wasmFile?: string) => Promise<import("types").FaustModule>;
        getFaustAudioWorkletProcessor: <Poly extends boolean = false>(dependencies: import("FaustAudioWorkletProcessor").FaustAudioWorkletProcessorDependencies<Poly>, faustData: import("FaustAudioWorkletProcessor").FaustData) => void;
        FaustDspInstance: typeof FaustDspInstance;
        FaustCompiler: typeof FaustCompiler;
        FaustWasmInstantiator: typeof FaustWasmInstantiator;
        FaustOfflineProcessor: typeof FaustOfflineProcessor;
        FaustSvgDiagrams: typeof FaustSvgDiagrams;
        LibFaust: typeof LibFaust;
        WavEncoder: typeof WavEncoder;
        WavDecoder: typeof WavDecoder;
    };
    export default _default;
}
declare module "faust2svgFiles" {
    function faust2svgFiles(inputFile: string, outputDir: string, argv?: string[] | undefined): Promise<Record<string, string>>;
    export { faust2svgFiles as default };
}
declare module "faust2wasmFiles" {
    function faust2wasmFiles(inputFile: string, outputDir: string, argv?: string[] | undefined, poly?: boolean | undefined): Promise<{
        dspMeta: import("types").FaustDspMeta;
        effectMeta: import("types").FaustDspMeta | null;
    }>;
    export { faust2wasmFiles as default };
}
declare module "faust2wavFiles" {
    function faust2wavFiles(inputFile: string, inputWav: string, outputWav: string, bufferSize?: number, sampleRate?: number, samples?: number, bitDepth?: number, argv?: string[] | undefined): Promise<void>;
    export { faust2wavFiles as default };
}
declare module "faustDsp2WamFiles" {
    function faustDsp2wam2Files(dspMeta: import("types").FaustDspMeta, effectMeta: import("types").FaustDspMeta, outputDir: string, poly?: boolean | undefined): Promise<void>;
    export function faustDspToWam2Descriptor(dspMeta: import("types").FaustDspMeta, effectMeta: import("types").FaustDspMeta, poly?: boolean | undefined): Record<string, any>;
    export { faustDsp2wam2Files as default };
}
