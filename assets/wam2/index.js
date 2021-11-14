/**
 * @typedef {import('./sdk-parammgr').ParamMgrNode} ParamMgrNode
 * @typedef {import("./types").FaustDspDistribution} FaustDspDistribution
 * @typedef {import("./types").FaustDspMeta} FaustDspMeta
 * @typedef {import("./types").FaustUIDescriptor} FaustUIDescriptor
 * @typedef {import("./types").IFaustUIGroup} IFaustUIGroup
 * @typedef {import("./types").IFaustUIItem} IFaustUIItem
 */

import { WebAudioModule, addFunctionModule } from './sdk/index.js';
import { CompositeAudioNode, ParamMgrFactory } from './sdk-parammgr/index.js';
import getFaustProcessor from "./FaustProcessor.js"
import FaustNode from "./FaustNode.js"
import createElement from './gui.js';

class FaustCompositeAudioNode extends CompositeAudioNode {
	/**
	 * @param {FaustNode} output
	 * @param {ParamMgrNode} paramMgr
	 */
	setup(output, paramMgr) {
		this.connect(output, 0, 0);
		paramMgr.addEventListener('wam-midi', (e) => output.midiMessage(e.detail.data.bytes));
		/** @type {ParamMgrNode} */
		this._wamNode = paramMgr;
		/** @type {FaustNode} */
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
		try {
			faustDsp.effectMeta = await (await fetch(`${this._baseURL}/effectMeta.json`)).json();
			faustDsp.effectModule = await WebAssembly.compileStreaming(await fetch(`${this._baseURL}/effectModule.wasm`));
			faustDsp.mixerModule = await WebAssembly.compileStreaming(await fetch(`${this._baseURL}/mixerModule.wasm`));
		} catch (error) {}
		const voices = faustDsp.mixerModule ? 64 : 0;
		await addFunctionModule(this.audioContext.audioWorklet, getFaustProcessor, this.moduleId + "Faust", voices, dspMeta, faustDsp.effectMeta);
		const faustNode = new FaustNode(this.audioContext, this.moduleId + "Faust", faustDsp, voices);
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
