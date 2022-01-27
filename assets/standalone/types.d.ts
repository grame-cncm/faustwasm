import { FaustDspMeta } from "./faustwasm";

export interface FaustDspDistribution {
    dspModule: WebAssembly.Module;
    dspMeta: FaustDspMeta;
    effectModule?: WebAssembly.Module;
    effectMeta?: FaustDspMeta;
    mixerModule?: WebAssembly.Module;
}
