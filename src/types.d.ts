export type FaustModuleFactory = EmscriptenModuleFactory<FaustModule>;

export interface FaustModule extends EmscriptenModule {
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
}

export interface FaustWebAssemblyExports extends WebAssembly.Exports {
    getParamValue($dsp: number, $param: number): number;
    setParamValue($dsp: number, $param: number, val: number): void;
    instanceClear($dsp: number): any;
    instanceResetUserInterface($dsp: number): void;
    instanceConstants($dsp: number, sampleRate: number): void;
    init($dsp: number, sampleRate: number): void;
    instanceInit($dsp: number, sampleRate: number): void;
    compute($dsp: number, bufferSize: number, $ins: number, $outs: number): any;
    memory: WebAssembly.Memory;
}

export interface FaustWebAssemblyMixerExports extends WebAssembly.Exports {
    clearOutput(count: number, channels: number, $outputs: number): void;
    mixVoice(count: number, channels: number, $inputs: number, $outputs: number): number;
}

export interface CompiledCode {
    wasmCModule: Uint8Array;
    code: string;
    helpers: string;
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
    meta: { [key: string]: string }[];
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
    style?: string; // "knob" | "menu{'Name0':value0;'Name1':value1}" | "radio{'Name0':value0;'Name1':value1}" | "led";
    unit?: string;
    scale?: "linear" | "exp" | "log";
    tooltip?: string;
    hidden?: string;
    [key: string]: string;
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
