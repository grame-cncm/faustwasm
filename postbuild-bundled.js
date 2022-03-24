//@ts-check
import { rmSync } from "./fileutils.js"
import * as path from "path";
import { fileURLToPath } from "url";

// @ts-ignore
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// @ts-ignore
const __filename = fileURLToPath(import.meta.url);

rmSync(path.join(__dirname, "./libfaust-wasm/libfaust-wasm.cjs"));
