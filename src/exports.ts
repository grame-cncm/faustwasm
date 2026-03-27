export { default as instantiateFaustModuleFromFile } from './instantiateFaustModuleFromFile';
// Raw Rust compiler-module loaders. These complement the historical
// `instantiateFaustModuleFromFile(...)` path and return the direct export
// surface of the `faust-rs` `wasm-ffi` compiler module.
export { default as instantiateRustFaustModule } from './instantiateRustFaustModule';
export { default as instantiateRustFaustModuleFromFile } from './instantiateRustFaustModuleFromFile';
export { default as getFaustAudioWorkletProcessor } from './FaustAudioWorkletProcessor';
export { default as getFaustFFTAudioWorkletProcessor } from './FaustFFTAudioWorkletProcessor';
export { default as FaustCompiler } from './FaustCompiler';
export { FaustDspInstance } from './FaustDspInstance';
export { default as FaustWasmInstantiator } from './FaustWasmInstantiator';
export { default as FaustOfflineProcessor } from './FaustOfflineProcessor';
export { default as FaustSvgDiagrams } from './FaustSvgDiagrams';
export { default as FaustCmajor } from './FaustCmajor';
export { default as LibFaust } from './LibFaust';
export { default as WavEncoder } from './WavEncoder';
export { default as WavDecoder } from './WavDecoder';
export { default as SoundfileReader } from './SoundfileReader';

export * from './FaustAudioWorkletNode';
export * from './FaustAudioWorkletProcessor';
export * from './FaustFFTAudioWorkletProcessor';
export * from './FaustCompiler';
export * from './FaustDspInstance';
export * from './FaustOfflineProcessor';
export * from './FaustScriptProcessorNode';
export * from './FaustWebAudioDsp';
export * from './FaustDspGenerator';
export * from './LibFaust';
export * from './instantiateRustFaustModule';
export * from './instantiateRustFaustModuleFromFile';

export * from './types';
