/**
 * Entry point of the monophonic AudioWorkletProcessor module.
 *
 * Not part of the main bundle: `build-worklets.js` bundles it on its own into
 * a string that `FaustMonoDspGenerator.createNode` loads into the
 * AudioWorkletGlobalScope, after a `const faustData = {...};` line.
 */
import getFaustAudioWorkletProcessor, {
    FaustData
} from '../FaustAudioWorkletProcessor';
import { FaustAudioWorkletProcessorCommunicator } from '../FaustAudioWorkletCommunicator';
import FaustWasmInstantiator from '../FaustWasmInstantiator';
import {
    FaustBaseWebAudioDsp,
    FaustMonoWebAudioDsp
} from '../FaustWebAudioDsp';

/** Prepended by the generator for each processor. */
declare const faustData: FaustData;

getFaustAudioWorkletProcessor<false>(
    {
        FaustBaseWebAudioDsp,
        FaustMonoWebAudioDsp,
        FaustWasmInstantiator,
        FaustAudioWorkletProcessorCommunicator,
        FaustPolyWebAudioDsp: undefined,
        FaustWebAudioDspVoice: undefined
    },
    faustData
);
