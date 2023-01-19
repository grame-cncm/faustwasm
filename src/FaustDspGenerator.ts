import { FaustMonoAudioWorkletNode, FaustPolyAudioWorkletNode } from "./FaustAudioWorkletNode";
import getFaustAudioWorkletProcessor, { FaustData } from "./FaustAudioWorkletProcessor";
import FaustDspInstance from "./FaustDspInstance";
import FaustWasmInstantiator from "./FaustWasmInstantiator";
import { FaustMonoOfflineProcessor, FaustPolyOfflineProcessor, IFaustMonoOfflineProcessor, IFaustPolyOfflineProcessor } from "./FaustOfflineProcessor";
import { FaustMonoScriptProcessorNode, FaustPolyScriptProcessorNode } from "./FaustScriptProcessorNode";
import { FaustBaseWebAudioDsp, FaustMonoWebAudioDsp, FaustPolyWebAudioDsp, FaustWebAudioDspVoice, IFaustMonoWebAudioNode, IFaustPolyWebAudioNode } from "./FaustWebAudioDsp";
import type { IFaustCompiler } from "./FaustCompiler";
import type { FaustDspFactory, FaustDspMeta, LooseFaustDspFactory } from "./types";

export interface IFaustMonoDspGenerator {
    /**
     * Compile a monophonic DSP factory from given code.
     * 
     * @param compiler - the Faust compiler
     * @param name - the DSP name
     * @param code - the DSP code
     * @param args - the compilation parameters
     * @returns the compiled factory or 'null' if failure
     */
    compile(compiler: IFaustCompiler, name: string, code: string, args: string): Promise<{
        factory: FaustDspFactory | null;
        name?: string;
        meta?: FaustDspMeta;
    } | null>;

    /**
     * Create a monophonic WebAudio node (either ScriptProcessorNode or AudioWorkletNode).
     *
     * @param context - the WebAudio context
     * @param name - AudioWorklet Processor name
     * @param factory - default is the compiled factory
     * @param sp - whether to compile a ScriptProcessorNode or an AudioWorkletNode
     * @param bufferSize - the buffer size in frames to be used in ScriptProcessorNode only, since AudioWorkletNode always uses 128 frames  
     * @returns the compiled WebAudio node or 'null' if failure
    */
    createNode(
        context: BaseAudioContext,
        name?: string,
        factory?: LooseFaustDspFactory,
        sp?: boolean,
        bufferSize?: number
    ): Promise<IFaustMonoWebAudioNode | null>;

    /**
    * Create a monophonic Offline processor.
    *
    * @param sampleRate - the sample rate in Hz
    * @param bufferSize - the buffer size in frames
    * @param factory - default is the compiled factory
    * @returns the compiled processor or 'null' if failure
    */
    createOfflineProcessor(sampleRate: number, bufferSize: number, factory?: LooseFaustDspFactory, meta?: FaustDspMeta): Promise<IFaustMonoOfflineProcessor | null>;
}

export interface IFaustPolyDspGenerator {
    /**
     * Compile a monophonic DSP factory from given code.
     * 
     * @param compiler - the Faust compiler
     * @param name - the DSP name
     * @param dspCode - the DSP code ('dsp_code' can possibly contain an integrated effect)
     * @param args - the compilation parameters
     * @param effectCode - optional effect DSP code
     * @returns the compiled factory or 'null' if failure
     */
    compile(compiler: IFaustCompiler, name: string, dspCode: string, args: string, effectCode?: string): Promise<{
        voiceFactory: FaustDspFactory | null;
        effectFactory?: FaustDspFactory | null;
    } | null>;
    /**
     * Create a polyphonic WebAudio node (either ScriptProcessorNode or AudioWorkletNode).
     *
     * @param context the WebAudio context
     * @param voices - the number of voices
     * @param name - AudioWorklet Processor name
     * @param voiceFactory - the Faust factory for voices, either obtained with a compiler (createDSPFactory) or loaded from files (loadDSPFactory)
     * @param mixerModule - the wasm Mixer module (loaded from 'mixer32.wasm' or 'mixer64.wasm' files)
     * @param effectFactory - the Faust factory for the effect, either obtained with a compiler (createDSPFactory) or loaded from files (loadDSPFactory)
     * @param sp - whether to compile a ScriptProcessorNode or an AudioWorkletNode
     * @param bufferSize - the buffer size in frames to be used in ScriptProcessorNode only, since AudioWorkletNode always uses 128 frames
     * @returns the compiled WebAudio node or 'null' if failure
     */
    createNode(
        context: BaseAudioContext,
        voices: number,
        name?: string,
        voiceFactory?: LooseFaustDspFactory,
        mixerModule?: WebAssembly.Module,
        effectFactory?: LooseFaustDspFactory | null,
        sp?: boolean,
        bufferSize?: number
    ): Promise<IFaustPolyWebAudioNode | null>;

    /**
     * Create a monophonic Offline processor.
     *
     * @param sampleRate - the sample rate in Hz
     * @param bufferSize - the buffer size in frames
     * @param voiceFactory - the Faust factory for voices, either obtained with a compiler (createDSPFactory) or loaded from files (loadDSPFactory)
     * @param mixerModule - the wasm Mixer module (loaded from 'mixer32.wasm' or 'mixer64.wasm' files)
     * @param effectFactory - the Faust factory for the effect, either obtained with a compiler (createDSPFactory) or loaded from files (loadDSPFactory)
     * @returns the compiled processor or 'null' if failure
     */
    createOfflineProcessor(
        sampleRate: number,
        bufferSize: number,
        voices: number,
        voiceFactory?: LooseFaustDspFactory,
        mixerModule?: WebAssembly.Module,
        effectFactory?: LooseFaustDspFactory | null 
    ): Promise<IFaustPolyOfflineProcessor | null>;
}

export class FaustMonoDspGenerator implements IFaustMonoDspGenerator {
    // Set of all created WorkletProcessors, each of them has to be unique
    private static gWorkletProcessors: Map<BaseAudioContext, Set<string>> = new Map();

    name: string;
    factory!: FaustDspFactory | null;

    constructor() {
        this.factory = null;
    }
    async compile(compiler: IFaustCompiler, name: string, code: string, args: string) {
        this.factory = await compiler.createMonoDSPFactory(name, code, args);
        if (!this.factory) return null;
        this.name = name;
        return this;
    }

    async createNode<SP extends boolean = false>(
        context: BaseAudioContext,
        name = this.name,
        factory = this.factory as LooseFaustDspFactory,
        sp = false as SP,
        bufferSize = 1024,
        processorName = factory?.shaKey || name
    ): Promise<SP extends true ? FaustMonoScriptProcessorNode | null : FaustMonoAudioWorkletNode | null> {
        if (!factory) throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");

        const meta = JSON.parse(factory.json);
        const sampleSize = meta.compile_options.match("-double") ? 8 : 4;
        if (sp) {
            const instance = await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
            const monoDsp = new FaustMonoWebAudioDsp(instance, context.sampleRate, sampleSize, bufferSize);
            const sp = context.createScriptProcessor(bufferSize, monoDsp.getNumInputs(), monoDsp.getNumOutputs()) as FaustMonoScriptProcessorNode;
            Object.setPrototypeOf(sp, FaustMonoScriptProcessorNode.prototype);
            sp.init(monoDsp);
            return sp as SP extends true ? FaustMonoScriptProcessorNode : FaustMonoAudioWorkletNode;
        } else {
            // Dynamically create AudioWorkletProcessor if code not yet created
            if (!FaustMonoDspGenerator.gWorkletProcessors.has(context)) FaustMonoDspGenerator.gWorkletProcessors.set(context, new Set());
            if (!FaustMonoDspGenerator.gWorkletProcessors.get(context)?.has(processorName)) {
                try {
                    const processorCode = `
// DSP name and JSON string for DSP are generated
const faustData = ${JSON.stringify({
    processorName,
    dspName: name,
    dspMeta: meta,
    poly: false
} as FaustData)};
// Implementation needed classes of functions
const ${FaustDspInstance.name}_default = ${FaustDspInstance.toString()}
const ${FaustBaseWebAudioDsp.name} = ${FaustBaseWebAudioDsp.toString()}
const ${FaustMonoWebAudioDsp.name} = ${FaustMonoWebAudioDsp.toString()}
const ${FaustWasmInstantiator.name} = ${FaustWasmInstantiator.toString()}
// Put them in dependencies
const dependencies = {
    ${FaustBaseWebAudioDsp.name},
    ${FaustMonoWebAudioDsp.name},
    ${FaustWasmInstantiator.name}
};
// Generate the actual AudioWorkletProcessor code
(${getFaustAudioWorkletProcessor.toString()})(dependencies, faustData);
`;
                    const url = URL.createObjectURL(new Blob([processorCode], { type: "text/javascript" }));
                    await context.audioWorklet.addModule(url);
                    // Keep the DSP name
                    FaustMonoDspGenerator.gWorkletProcessors.get(context)?.add(processorName);
                } catch (e) {
                    // console.error(`=> exception raised while running createMonoNode: ${e}`);
                    // console.error(`=> check that your page is served using https.${e}`);
                    throw e;
                }
            }
            // Create the AWN
            const node = new FaustMonoAudioWorkletNode(context, processorName, factory, sampleSize)
            return node as SP extends true ? FaustMonoScriptProcessorNode : FaustMonoAudioWorkletNode;
        }
    }
    async createAudioWorkletProcessor(
        name = this.name,
        factory = this.factory as LooseFaustDspFactory,
        processorName = factory?.shaKey || name
    ) {
        if (!factory) throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");

        const meta = JSON.parse(factory.json);
        const dependencies = {
            FaustBaseWebAudioDsp,
            FaustMonoWebAudioDsp,
            FaustWasmInstantiator,
            FaustPolyWebAudioDsp: undefined,
            FaustWebAudioDspVoice: undefined,
        }
        // const sampleSize = meta.compile_options.match("-double") ? 8 : 4;
        // Dynamically create AudioWorkletProcessor if code not yet created
            try {
                // DSP name and JSON string for DSP are generated
                const faustData = {
                    processorName,
                    dspName: name,
                    dspMeta: meta,
                    poly: false
                } as FaustData;
                // Generate the actual AudioWorkletProcessor code
                const Processor = getFaustAudioWorkletProcessor(dependencies, faustData);
                return Processor;
            } catch (e) {
                // console.error(`=> exception raised while running createMonoNode: ${e}`);
                // console.error(`=> check that your page is served using https.${e}`);
                throw e;
            }
    }
    async createOfflineProcessor(
        sampleRate: number,
        bufferSize: number,
        factory = this.factory as LooseFaustDspFactory,
    ) {
        if (!factory) throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");

        const meta = JSON.parse(factory.json);
        const instance = await FaustWasmInstantiator.createAsyncMonoDSPInstance(factory);
        const sampleSize = meta.compile_options.match("-double") ? 8 : 4;
        const monoDsp = new FaustMonoWebAudioDsp(instance, sampleRate, sampleSize, bufferSize);
        return new FaustMonoOfflineProcessor(monoDsp, bufferSize);
    }
}

export class FaustPolyDspGenerator implements IFaustPolyDspGenerator {
    // Set of all created WorkletProcessors, each of them has to be unique
    private static gWorkletProcessors: Map<BaseAudioContext, Set<string>> = new Map();

    name: string;
    voiceFactory!: FaustDspFactory | null;
    effectFactory!: FaustDspFactory | null;
    mixerBuffer!: Uint8Array;
    mixerModule!: WebAssembly.Module;

    constructor() {
        this.voiceFactory = null;
        this.effectFactory = null;
    }
    async compile(
        compiler: IFaustCompiler,
        name: string,
        dspCode: string,
        args: string,
        effectCode = `
adapt(1,1) = _; adapt(2,2) = _,_; adapt(1,2) = _ <: _,_; adapt(2,1) = _,_ :> _;
adaptor(F,G) = adapt(outputs(F),inputs(G));
dsp_code = environment{${dspCode}};
process = adaptor(dsp_code.process, dsp_code.effect) : dsp_code.effect;`
    ) {
        this.voiceFactory = await compiler.createPolyDSPFactory(name, dspCode, args);
        if (!this.voiceFactory) return null;
        // Compile effect, possibly failing since 'compilePolyNode2' can be called by called by 'compilePolyNode'
        try {
            this.effectFactory = await compiler.createPolyDSPFactory(name, effectCode, args);
        } catch (e) {
            console.warn(e);
        }
        this.name = name;
        const voiceMeta = JSON.parse(this.voiceFactory.json);
        const isDouble = voiceMeta.compile_options.match("-double");
        const { mixerBuffer, mixerModule } = await compiler.getAsyncInternalMixerModule(!!isDouble);
        this.mixerBuffer = mixerBuffer;
        this.mixerModule = mixerModule;
        return this;
    }

    async createNode<SP extends boolean = false>(
        context: BaseAudioContext,
        voices: number,
        name = this.name,
        voiceFactory = this.voiceFactory as LooseFaustDspFactory,
        mixerModule = this.mixerModule,
        effectFactory = this.effectFactory as LooseFaustDspFactory | null,
        sp = false as SP,
        bufferSize = 1024,
        processorName = ((voiceFactory?.shaKey || "") + (effectFactory?.shaKey || "")) || `${name}_poly`
    ): Promise<SP extends true ? FaustPolyScriptProcessorNode | null : FaustPolyAudioWorkletNode | null> {
        if (!voiceFactory) throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");

        const voiceMeta = JSON.parse(voiceFactory.json);
        const effectMeta = effectFactory ? JSON.parse(effectFactory.json) : undefined;
        const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
        if (sp) {
            const instance = await FaustWasmInstantiator.createAsyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory || undefined);
            const polyDsp = new FaustPolyWebAudioDsp(instance, context.sampleRate, sampleSize, bufferSize);
            const sp = context.createScriptProcessor(bufferSize, polyDsp.getNumInputs(), polyDsp.getNumOutputs()) as FaustPolyScriptProcessorNode;
            Object.setPrototypeOf(sp, FaustPolyScriptProcessorNode.prototype);
            sp.init(polyDsp);
            return sp as SP extends true ? FaustPolyScriptProcessorNode : FaustPolyAudioWorkletNode;
        } else {
            // Dynamically create AudioWorkletProcessor if code not yet created
            if (!FaustPolyDspGenerator.gWorkletProcessors.has(context)) FaustPolyDspGenerator.gWorkletProcessors.set(context, new Set());
            if (!FaustPolyDspGenerator.gWorkletProcessors.get(context)?.has(processorName)) {
                try {
                    const processorCode = `
// DSP name and JSON string for DSP are generated
const faustData = ${JSON.stringify({
    processorName,
    dspName: name,
    dspMeta: voiceMeta,
    poly: true,
    effectMeta
} as FaustData)};
// Implementation needed classes of functions
const ${FaustDspInstance.name}_default = ${FaustDspInstance.toString()}
const ${FaustBaseWebAudioDsp.name} = ${FaustBaseWebAudioDsp.toString()}
const ${FaustPolyWebAudioDsp.name} = ${FaustPolyWebAudioDsp.toString()}
const ${FaustWebAudioDspVoice.name} = ${FaustWebAudioDspVoice.toString()}
const ${FaustWasmInstantiator.name} = ${FaustWasmInstantiator.toString()}
// Put them in dependencies
const dependencies = {
    ${FaustBaseWebAudioDsp.name},
    ${FaustPolyWebAudioDsp.name},
    ${FaustWasmInstantiator.name}
};
// Generate the actual AudioWorkletProcessor code
(${getFaustAudioWorkletProcessor.toString()})(dependencies, faustData);
`;
                    const url = URL.createObjectURL(new Blob([processorCode], { type: "text/javascript" }));
                    await context.audioWorklet.addModule(url);
                    // Keep the DSP name
                    FaustPolyDspGenerator.gWorkletProcessors.get(context)?.add(processorName);
                } catch (e) {
                    // console.error(`=> exception raised while running createPolyNode: ${e}`);
                    // console.error(`=> check that your page is served using https.${e}`);
                    throw e;
                }
            }
            // Create the AWN
            const node = new FaustPolyAudioWorkletNode(context, processorName, voiceFactory, mixerModule, voices, sampleSize, effectFactory || undefined);
            return node as SP extends true ? FaustPolyScriptProcessorNode : FaustPolyAudioWorkletNode;
        }
    }
    async createAudioWorkletProcessor(
        name = this.name,
        voiceFactory = this.voiceFactory as LooseFaustDspFactory,
        effectFactory = this.effectFactory as LooseFaustDspFactory | null,
        processorName = ((voiceFactory?.shaKey || "") + (effectFactory?.shaKey || "")) || `${name}_poly`
    ) {
        if (!voiceFactory) throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");

        const voiceMeta = JSON.parse(voiceFactory.json);
        const effectMeta = effectFactory ? JSON.parse(effectFactory.json) : undefined;
        const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
        // Dynamically create AudioWorkletProcessor if code not yet created
            try {
                const dependencies = {
                    FaustBaseWebAudioDsp,
                    FaustMonoWebAudioDsp: undefined,
                    FaustWasmInstantiator,
                    FaustPolyWebAudioDsp,
                    FaustWebAudioDspVoice,
                };
                // DSP name and JSON string for DSP are generated
                const faustData = {
                    processorName,
                    dspName: name,
                    dspMeta: voiceMeta,
                    poly: true,
                    effectMeta
                } as FaustData;
                // Generate the actual AudioWorkletProcessor code
                const Processor = getFaustAudioWorkletProcessor<true>(dependencies, faustData);
                return Processor;
            } catch (e) {
                // console.error(`=> exception raised while running createPolyNode: ${e}`);
                // console.error(`=> check that your page is served using https.${e}`);
                throw e;
            }
    }
    async createOfflineProcessor(
        sampleRate: number,
        bufferSize: number,
        voices: number,
        voiceFactory = this.voiceFactory as LooseFaustDspFactory,
        mixerModule = this.mixerModule,
        effectFactory = this.effectFactory as LooseFaustDspFactory | null
    ) {
        if (!voiceFactory) throw new Error("Code is not compiled, please define the factory or call `await this.compile()` first.");

        const voiceMeta = JSON.parse(voiceFactory.json);
        const effectMeta = effectFactory ? JSON.parse(effectFactory.json) : undefined;
        const instance = await FaustWasmInstantiator.createAsyncPolyDSPInstance(voiceFactory, mixerModule, voices, effectFactory || undefined);
        const sampleSize = voiceMeta.compile_options.match("-double") ? 8 : 4;
        const polyDsp = new FaustPolyWebAudioDsp(instance, sampleRate, sampleSize, bufferSize);
        return new FaustPolyOfflineProcessor(polyDsp, bufferSize);
    }
}
