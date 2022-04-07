import * as FaustWasm from "./exports-bundle";

export * from "./exports-bundle";
export default FaustWasm;

(globalThis as any).faustwasm = FaustWasm;
