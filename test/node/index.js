
const path = require("path");

/** @type {import("../../dist")} */
const { instantiateLibFaust, Faust } = require(path.join(__dirname, "../../dist"));

instantiateLibFaust(path.join(__dirname, "../../libfaust-wasm/libfaust-wasm.js")).then((libFaust) => {
    const faust = new Faust(libFaust);
    console.log(faust.getLibFaustVersion());
});
