/** @type {HTMLMediaElement} */
const player = document.querySelector('#player');
/** @type {HTMLDivElement} */
const mount = document.querySelector('#mount');

const audioContext = new AudioContext();
const mediaElementSource = audioContext.createMediaElementSource(player);

(async () => {
	// Init WamEnv
	const { initializeWamHost } = await import('../sdk/index.js');
	const [hostGroupId] = await initializeWamHost(audioContext);

	// Load the WAM
	const { default: WAM } = await import("../index.js");

	// Create a new instance of the plugin
	// You can can optionnally give more options such as the initial state of the plugin
	const wamInstance = await WAM.createInstance(hostGroupId, audioContext);

	// Connect the audionode to the host
	mediaElementSource.connect(wamInstance.audioNode);
	wamInstance.audioNode.connect(audioContext.destination);

	// Load the GUI if need (ie. if the option noGui was set to true)
	// And calls the method createElement of the Gui module
	const wamGui = await wamInstance.createGui();

	// Mount the GUI
	mount.innerHTML = '';
	mount.appendChild(wamGui);

	player.onplay = () => {
		audioContext.resume(); // audio context must be resumed because browser restrictions
	};
})();
