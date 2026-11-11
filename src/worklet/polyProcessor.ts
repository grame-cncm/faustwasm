/**
 * Entry point of the polyphonic AudioWorkletProcessor module.
 *
 * Not part of the main bundle: `build-worklets.js` bundles it on its own into
 * a string that `FaustPolyDspGenerator.createNode` loads into the
 * AudioWorkletGlobalScope, after a `const faustData = {...};` line.
 */
import getFaustAudioWorkletProcessor, {
    FaustData
} from '../FaustAudioWorkletProcessor';
import { FaustAudioWorkletProcessorCommunicator } from '../FaustAudioWorkletCommunicator';
import FaustWasmInstantiator from '../FaustWasmInstantiator';
import {
    FaustBaseWebAudioDsp,
    FaustPolyWebAudioDsp,
    FaustWebAudioDspVoice
} from '../FaustWebAudioDsp';

/** Prepended by the generator for each processor. */
declare const faustData: FaustData;

getFaustAudioWorkletProcessor<true>(
    {
        FaustBaseWebAudioDsp,
        FaustMonoWebAudioDsp: undefined,
        FaustPolyWebAudioDsp,
        FaustWebAudioDspVoice,
        FaustWasmInstantiator,
        FaustAudioWorkletProcessorCommunicator
    },
    faustData
);
