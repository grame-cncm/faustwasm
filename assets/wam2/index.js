/**
 * @typedef {import('./sdk-parammgr').ParamMgrNode} ParamMgrNode
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./faustwasm").FaustAudioWorkletNode} FaustAudioWorkletNode
 * @typedef {import("./faustwasm").FaustDspMeta} FaustDspMeta
 * @typedef {import("./faustwasm").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./faustwasm").IFaustUIGroup} IFaustUIGroup
 * @typedef {import("./faustwasm").IFaustUIItem} IFaustUIItem
 */

import { WebAudioModule } from './sdk/index.js';
import { CompositeAudioNode, ParamMgrFactory } from './sdk-parammgr/index.js';
import { FaustMonoDspGenerator, FaustPolyDspGenerator } from "./faustwasm.js"
import createElement from './gui.js';

class FaustCompositeAudioNode extends CompositeAudioNode {
	/**
	 * @param {FaustAudioWorkletNode} output
	 * @param {ParamMgrNode} paramMgr
	 */
	setup(output, paramMgr) {
		if (output.numberOfInputs > 0) this.connect(output, 0, 0);
		paramMgr.addEventListener('wam-midi', (e) => output.midiMessage(e.detail.data.bytes));
		/** @type {ParamMgrNode} */
		this._wamNode = paramMgr;
		/** @type {FaustAudioWorkletNode} */
		this._output = output;
	}

	destroy() {
		super.destroy();
		if (this._output) this._output.destroy();
	}

	/**
	 * @param {string} name
	 */
	getParamValue(name) {
		return this._wamNode.getParamValue(name);
	}

	/**
	 * @param {string} name
	 * @param {number} value
	 */
	setParamValue(name, value) {
		return this._wamNode.setParamValue(name, value);
	}
}

/**
 * @param {URL} relativeURL
 * @returns {string}
 */
const getBasetUrl = (relativeURL) => {
	const baseURL = relativeURL.href.substring(0, relativeURL.href.lastIndexOf('/'));
	return baseURL;
};

export default class FaustPingPongDelayPlugin extends WebAudioModule {
	/**
	 * Faust generated WebAudio AudioWorkletNode Constructor
	 */
	_PluginFactory;

	_baseURL = getBasetUrl(new URL('.', import.meta.url));

	_descriptorUrl = `${this._baseURL}/descriptor.json`;

	async initialize(state) {
		await this._loadDescriptor();
		return super.initialize(state);
	}

	async createAudioNode(initialState) {
		const dspMeta = await (await fetch(`${this._baseURL}/dspMeta.json`)).json();
		const dspModule = await WebAssembly.compileStreaming(await fetch(`${this._baseURL}/dspModule.wasm`));
		/** @type {FaustDspDistribution} */
		const faustDsp = { dspMeta, dspModule };
		if (this.descriptor.faustMeta?.effect) {
			faustDsp.effectMeta = await (await fetch(`${this._baseURL}/effectMeta.json`)).json();
			faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch(`${this._baseURL}/effectModule.wasm`));
		}
		if (this.descriptor.faustMeta?.poly) {
			faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch(`${this._baseURL}/mixerModule.wasm`));
		}
		const voices = faustDsp.mixerModule ? 64 : 0;

		/** @type {FaustAudioWorkletNode} */
		let faustNode;
		if (voices) {
			const generator = new FaustPolyDspGenerator();
			faustNode = await generator.createNode(
				this.audioContext,
				voices,
				this.moduleId + "Faust",
				{ module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta) },
				faustDsp.mixerModule,
				faustDsp.effectModule ? { module: faustDsp.effectModule, json: JSON.stringify(faustDsp.effectMeta) } : undefined
			);
		} else {
			const generator = new FaustMonoDspGenerator();
			faustNode = await generator.createNode(
				this.audioContext,
				this.moduleId + "Faust",
				{ module: faustDsp.dspModule, json: JSON.stringify(faustDsp.dspMeta) }
			);
		}
		const paramMgrNode = await ParamMgrFactory.create(this, { internalParamsConfig: Object.fromEntries(faustNode.parameters) });
		const node = new FaustCompositeAudioNode(this.audioContext);
		node.setup(faustNode, paramMgrNode);
		if (initialState) node.setState(initialState);
		return node;
	}

	createGui() {
		return createElement(this);
	}
}
