//@ts-check
(async () => {
	const {
		instantiateLibFaust,
		LibFaust,
		WavEncoder,
		FaustWasmInstantiator,
		FaustMonoDspGenerator,
		FaustCompiler
	} = await import("../../dist/esm/index.js");
    const faustModule = await instantiateLibFaust("../../libfaust-wasm/libfaust-wasm.js");
    const libFaust = new LibFaust(faustModule);
	window.faust = libFaust;
    console.log(libFaust.version());

    const sampleRate = 48000;
    const args = ["-I", "libraries/"];
	const code1Fetch = await fetch("../p-dj.dsp");
    const code1 = await code1Fetch.text();
	const name1 = "pdj";
	const code2Fetch = await fetch("../rev.dsp");
    const code2 = await code2Fetch.text();

	const ctx = new AudioContext();

	const compiler = new FaustCompiler(libFaust);
	const f = new FaustMonoDspGenerator();
	const node = await f.compileNode(ctx, name1, compiler, code1, args.join(" "));
	node.start();
	window.node = node;
	node.connect(ctx.destination);
	window.ctx = ctx;
	console.log(node);
	const op = await f.createOfflineProcessor(f.fFactory, 48000, 256);
	window.op = op;
	const out = op.render();
	console.log(out);
	/*
    const dsp1 = await faust.compile(code1, args);
    const svgs = faust.getDiagram(code1, args);
    console.log(Object.keys(svgs));
    const processor1 = new FaustProcessor({ dsp: dsp1, sampleRate });
	await processor1.initialize();
    const out1 = processor1.generate(null, 192000);
    const wav1 = WavEncoder.encode(out1, { sampleRate, bitDepth: 24 });
	const blob1 = new Blob([wav1], { type: "audio/wav" });
	const player1 = document.createElement("audio");
	player1.controls = true;
	player1.src = URL.createObjectURL(blob1);
	document.body.appendChild(player1);

    const dsp2 = await faust.compile(code2, args);
    const processor2 = new FaustProcessor({ dsp: dsp2, sampleRate });
	await processor2.initialize();
    const out2 = processor2.generate(out1, 192000);
    const wav2 = WavEncoder.encode(out2, { sampleRate, bitDepth: 24 });
	const blob2 = new Blob([wav2], { type: "audio/wav" });
	const player2 = document.createElement("audio");
	player2.controls = true;
	player2.src = URL.createObjectURL(blob2);
	document.body.appendChild(player2);

	document.getElementById("info").innerText = "Generated!";
	*/
})();
