import * as faustwasm from "./exports-bundle";
// export default faustwasm;
// Bug with dts-bundle-generator

export * from "./exports-bundle";

(globalThis as any).faustwasm = faustwasm;
