//@ts-check
import * as fs from 'fs';
import * as path from 'path';
import { cpSync, cpSyncModify } from '../fileutils.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A build stamp, as `YYYYMMDD-HHmm`.
 *
 * The service worker names its cache `<dspName>_VERSION_DATE`, so this string
 * is what makes a redeployed application drop the assets it cached last time
 * instead of serving them forever.
 *
 * @returns {string}
 */
const versionDate = () => {
    const now = new Date();
    return (
        now.getFullYear().toString() +
        ('0' + (now.getMonth() + 1)).slice(-2) +
        ('0' + now.getDate()).slice(-2) +
        '-' +
        ('0' + now.getHours()).slice(-2) +
        ('0' + now.getMinutes()).slice(-2)
    );
};

/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 * @param {boolean} [effect] - Whether the DSP has an effect module.
 */
const copyWebStandaloneAssets = (
    outputDir,
    dspName,
    poly = false,
    effect = false
) => {
    console.log(`Writing assets files.`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Define find and replace patterns
    const findAndReplace = [
        'FAUST_DSP_NAME',
        dspName,
        'VERSION_DATE',
        versionDate()
    ];
    if (poly)
        findAndReplace.push('FAUST_DSP_VOICES = 0', 'FAUST_DSP_VOICES = 16');
    if (poly && effect)
        findAndReplace.push(
            'FAUST_DSP_HAS_EFFECT = false',
            'FAUST_DSP_HAS_EFFECT = true'
        );

    // Copy some files
    const createNodeJSPath = path.join(
        __dirname,
        '../assets/standalone/create-node.js'
    );
    cpSyncModify(
        createNodeJSPath,
        outputDir + `/create-node.js`,
        ...findAndReplace
    );

    const templateJSPath = path.join(
        __dirname,
        '../assets/standalone/index.js'
    );
    cpSyncModify(templateJSPath, outputDir + `/index.js`, ...findAndReplace);

    const templateHTMLPath = path.join(
        __dirname,
        '../assets/standalone/index.html'
    );
    cpSyncModify(
        templateHTMLPath,
        outputDir + `/index.html`,
        ...findAndReplace
    );

    const templateWorkerPath = path.join(
        __dirname,
        '../assets/standalone/service-worker.js'
    );
    cpSyncModify(
        templateWorkerPath,
        outputDir + `/service-worker.js`,
        ...findAndReplace
    );

    const templateIconPath = path.join(
        __dirname,
        '../assets/standalone/icon.png'
    );
    cpSync(templateIconPath, outputDir + `/icon.png`);

    const faustwasmPath = path.join(
        __dirname,
        '../assets/standalone/faustwasm'
    );
    cpSync(faustwasmPath, outputDir + '/faustwasm');

    const faustuiPath = path.join(__dirname, '../assets/standalone/faust-ui');
    cpSync(faustuiPath, outputDir + '/faust-ui');

    const templateManifestPath = path.join(
        __dirname,
        '../assets/standalone/manifest.json'
    );
    cpSyncModify(
        templateManifestPath,
        outputDir + `/manifest.json`,
        ...findAndReplace
    );
};

/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 * @param {boolean} [effect] - Whether the DSP has an effect module.
 */
const copyWebPWAAssets = (outputDir, dspName, poly = false, effect = false) => {
    console.log(`Writing assets files.`);
    fs.mkdirSync(outputDir, { recursive: true });

    // Define find and replace patterns
    const findAndReplace = [
        'FAUST_DSP_NAME',
        dspName,
        'VERSION_DATE',
        versionDate()
    ];

    if (poly)
        findAndReplace.push('FAUST_DSP_VOICES = 0', 'FAUST_DSP_VOICES = 16');
    if (poly && effect)
        findAndReplace.push(
            'FAUST_DSP_HAS_EFFECT = false',
            'FAUST_DSP_HAS_EFFECT = true'
        );

    // Copy some files
    const createNodeJSPath = path.join(
        __dirname,
        '../assets/standalone/create-node.js'
    );
    cpSyncModify(
        createNodeJSPath,
        outputDir + `/create-node.js`,
        ...findAndReplace
    );

    const templateJSPath = path.join(
        __dirname,
        '../assets/standalone/index-pwa.js'
    );
    cpSyncModify(templateJSPath, outputDir + `/index.js`, ...findAndReplace);

    const templatePWAJSPath = path.join(
        __dirname,
        '../assets/standalone/faust-pwa.js'
    );
    cpSyncModify(
        templatePWAJSPath,
        outputDir + `/faust-pwa.js`,
        ...findAndReplace
    );

    const templateHTMLPath = path.join(
        __dirname,
        '../assets/standalone/index-pwa.html'
    );
    cpSyncModify(
        templateHTMLPath,
        outputDir + `/index.html`,
        ...findAndReplace
    );

    const templateWorkerPath = path.join(
        __dirname,
        '../assets/standalone/service-worker.js'
    );
    cpSyncModify(
        templateWorkerPath,
        outputDir + `/service-worker.js`,
        ...findAndReplace
    );

    const templateIconPath = path.join(
        __dirname,
        '../assets/standalone/icon.png'
    );
    cpSync(templateIconPath, outputDir + `/icon.png`);

    const faustwasmPath = path.join(
        __dirname,
        '../assets/standalone/faustwasm'
    );
    cpSync(faustwasmPath, outputDir + '/faustwasm');

    const faustuiPath = path.join(__dirname, '../assets/standalone/faust-ui');
    cpSync(faustuiPath, outputDir + '/faust-ui');

    const templateManifestPath = path.join(
        __dirname,
        '../assets/standalone/manifest.json'
    );
    cpSyncModify(
        templateManifestPath,
        outputDir + `/manifest.json`,
        ...findAndReplace
    );
};
/**
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 * @param {boolean} [effect] - Whether the DSP has an effect module.
 */
const copyWebTemplateAssets = (
    outputDir,
    dspName,
    poly = false,
    effect = false
) => {
    // Create output directory if it doesn't exist
    fs.mkdirSync(outputDir, { recursive: true });

    // Define find and replace patterns
    const findAndReplace = ['FAUST_DSP_NAME', dspName];

    if (poly)
        findAndReplace.push('FAUST_DSP_VOICES = 0', 'FAUST_DSP_VOICES = 16');
    if (poly && effect)
        findAndReplace.push(
            'FAUST_DSP_HAS_EFFECT = false',
            'FAUST_DSP_HAS_EFFECT = true'
        );

    // Copy some files
    const createNodeJSPath = path.join(
        __dirname,
        '../assets/standalone/create-node.js'
    );
    cpSyncModify(
        createNodeJSPath,
        outputDir + `/create-node.js`,
        ...findAndReplace
    );

    const templateJSPath = path.join(
        __dirname,
        '../assets/standalone/index-template.js'
    );
    cpSyncModify(templateJSPath, outputDir + `/index.js`, ...findAndReplace);

    const templateHTMLPath = path.join(
        __dirname,
        '../assets/standalone/index-template.html'
    );
    cpSyncModify(
        templateHTMLPath,
        outputDir + `/index.html`,
        'index-template.js',
        'index.js',
        ...findAndReplace
    );

    const faustwasmPath = path.join(
        __dirname,
        '../assets/standalone/faustwasm'
    );
    cpSync(faustwasmPath, outputDir + '/faustwasm');
};

/**
 * A remote-controlled application: the host page at the top of `outputDir`
 * (the DSP, its sound, a local UI, the pairing link), and the remote control
 * PWA in `outputDir/remote/` (no DSP, no wasm: its interface comes from the
 * host). The remote control bundles are copied from `dist/remote` into
 * `faustwasm-remote/`: the host page loads `host.js`, the remote control
 * `client.js`. Serve `outputDir` with `faust-remote-server-ts`.
 *
 * @param {string} outputDir - The output directory.
 * @param {string} dspName - The name of the DSP to be loaded.
 * @param {boolean} [poly] - Whether the DSP is polyphonic.
 * @param {boolean} [effect] - Whether the DSP has an effect module.
 */
const copyWebRemoteAssets = (
    outputDir,
    dspName,
    poly = false,
    effect = false
) => {
    console.log(`Writing assets files.`);
    const remoteBundle = path.join(__dirname, '../dist/remote');
    // One bundle per role; the complete index.js is for the API, not for pages
    const remoteFiles = ['client.js', 'host.js'];
    for (const file of remoteFiles)
        if (!fs.existsSync(path.join(remoteBundle, file)))
            throw new Error(
                `${remoteBundle}/${file} is missing: build the package first (npm run build-esm)`
            );
    fs.mkdirSync(path.join(outputDir, 'remote'), { recursive: true });

    const findAndReplace = [
        'FAUST_DSP_NAME',
        dspName,
        'VERSION_DATE',
        versionDate()
    ];
    if (poly)
        findAndReplace.push('FAUST_DSP_VOICES = 0', 'FAUST_DSP_VOICES = 16');
    if (poly && effect)
        findAndReplace.push(
            'FAUST_DSP_HAS_EFFECT = false',
            'FAUST_DSP_HAS_EFFECT = true'
        );

    const asset = (/** @type {string} */ name) =>
        path.join(__dirname, '../assets', name);
    /** @type {[string, string][]} */
    const templates = [
        ['standalone/create-node.js', 'create-node.js'],
        ['remote/host.html', 'index.html'],
        ['remote/host.js', 'index.js'],
        ['remote/remote.html', 'remote/index.html'],
        ['remote/remote.js', 'remote/index.js'],
        ['remote/remote-service-worker.js', 'remote/service-worker.js'],
        ['remote/remote-manifest.json', 'remote/manifest.json']
    ];
    for (const [from, to] of templates)
        cpSyncModify(asset(from), path.join(outputDir, to), ...findAndReplace);
    cpSync(
        asset('standalone/icon.png'),
        path.join(outputDir, 'remote/icon.png')
    );
    cpSync(asset('standalone/faustwasm'), path.join(outputDir, 'faustwasm'));
    cpSync(asset('standalone/faust-ui'), path.join(outputDir, 'faust-ui'));
    fs.mkdirSync(path.join(outputDir, 'faustwasm-remote'), {
        recursive: true
    });
    for (const file of remoteFiles) {
        for (const name of [file, `${file}.map`]) {
            const from = path.join(remoteBundle, name);
            if (fs.existsSync(from))
                cpSync(from, path.join(outputDir, 'faustwasm-remote', name));
        }
    }
};

export {
    copyWebStandaloneAssets,
    copyWebPWAAssets,
    copyWebTemplateAssets,
    copyWebRemoteAssets
};
