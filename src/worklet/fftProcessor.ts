/**
 * Entry point of the FFT AudioWorkletProcessor module.
 *
 * Not part of the main bundle: `build-worklets.js` bundles it on its own into
 * a string that `FaustMonoDspGenerator.createFFTNode` loads into the
 * AudioWorkletGlobalScope, after a `const faustData = {...};` line and the
 * caller's `FFTUtils` class.
 */
import getFaustFFTAudioWorkletProcessor, {
    FaustFFTData
} from '../FaustFFTAudioWorkletProcessor';
import { FaustAudioWorkletProcessorCommunicator } from '../FaustAudioWorkletCommunicator';
import FaustWasmInstantiator from '../FaustWasmInstantiator';
import {
    FaustBaseWebAudioDsp,
    FaustMonoWebAudioDsp
} from '../FaustWebAudioDsp';
import type { FFTUtils as FFTUtilsClass } from '../types';

/** Prepended by the generator for each processor. */
declare const faustData: FaustFFTData;
/** The caller's FFT implementation, also prepended by the generator. */
declare const FFTUtils: typeof FFTUtilsClass;

getFaustFFTAudioWorkletProcessor(
    {
        FaustBaseWebAudioDsp,
        FaustMonoWebAudioDsp,
        FaustWasmInstantiator,
        FaustAudioWorkletProcessorCommunicator,
        FFTUtils
    },
    faustData
);
