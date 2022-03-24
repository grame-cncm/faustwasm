import { FaustDspMeta } from "./types";

declare const faust2wasmFiles: (inputFile: string, outputDir: string, argv?: string[], poly?: boolean) => Promise<{ dspMeta: FaustDspMeta; effectMeta: FaustDspMeta | null }>;

export default faust2wasmFiles;
