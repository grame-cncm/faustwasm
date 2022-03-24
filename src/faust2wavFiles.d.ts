declare const faust2wavFiles: (inputFile: string, inputWav: string, outputWav: string, bufferSize?: number, sampleRate?: number, samples?: number, bitDepth?: number, argv?: string[]) => Promise<void>;

export default faust2wavFiles;
