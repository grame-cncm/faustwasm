import { FaustBaseWebAudioDsp } from './FaustWebAudioDsp';
import WavDecoder from './WavDecoder';
import type {
    AudioData,
    FaustDspMeta,
    FaustUIItem,
    LooseFaustDspFactory
} from './types';

/** Read metadata and fetch soundfiles */
class SoundfileReader {
    /**
     * Set fallback base URLs used to resolve soundfile paths.
     *
     * In Node or other non-browser runtimes, `location` may be undefined;
     * in that case this returns an empty list to avoid resolution errors.
     */
    static get fallbackPaths() {
        const loc =
            typeof location !== 'undefined' ? (location as Location) : null;
        const href = loc?.href;
        const origin = loc?.origin;
        const parent = href ? this.getParentUrl(href) : null;
        return [href, parent, origin].filter(
            (value): value is string =>
                typeof value === 'string' && value.length > 0
        );
    }

    /**
     * Extract the parent URL from an URL.
     * @param url : the URL
     * @returns : the parent URL
     */
    private static getParentUrl(url: string) {
        return url.substring(0, url.lastIndexOf('/') + 1);
    }

    /**
     * Convert an audio buffer to audio data.
     *
     * @param audioBuffer : the audio buffer to convert
     * @returns : the audio data
     */
    private static toAudioData(audioBuffer: AudioBuffer): AudioData {
        const { sampleRate, numberOfChannels } = audioBuffer;
        return {
            sampleRate,
            audioBuffer: new Array(numberOfChannels)
                .fill(null)
                .map((v, i) => audioBuffer.getChannelData(i))
        } as AudioData;
    }

    private static isWaveFile(buffer: ArrayBuffer) {
        if (buffer.byteLength < 12) return false;
        const reader = new DataView(buffer);
        const riff =
            reader.getUint8(0) === 0x52 &&
            reader.getUint8(1) === 0x49 &&
            reader.getUint8(2) === 0x46 &&
            reader.getUint8(3) === 0x46;
        const wave =
            reader.getUint8(8) === 0x57 &&
            reader.getUint8(9) === 0x41 &&
            reader.getUint8(10) === 0x56 &&
            reader.getUint8(11) === 0x45;
        return riff && wave;
    }

    private static decodeWaveFile(buffer: ArrayBuffer): AudioData {
        const decoded = WavDecoder.decode(buffer);
        return {
            sampleRate: decoded.sampleRate,
            audioBuffer: decoded.channelData
        };
    }

    /**
     * Extract the URLs from the metadata.
     *
     * @param dspMeta : the metadata
     * @returns : the URLs
     */
    static findSoundfilesFromMeta(
        dspMeta: FaustDspMeta
    ): LooseFaustDspFactory['soundfiles'] {
        const soundfiles: LooseFaustDspFactory['soundfiles'] = {};
        const callback = (item: FaustUIItem) => {
            if (item.type === 'soundfile') {
                const urls = FaustBaseWebAudioDsp.splitSoundfileNames(item.url);
                // soundfiles.map[item.label] = urls;
                urls.filter((url) => url.trim().length > 0).forEach(
                    (url) => (soundfiles[url] = null)
                );
            }
        };
        FaustBaseWebAudioDsp.parseUI(dspMeta.ui, callback);
        return soundfiles;
    }
    /**
     * Fetch the soundfile.
     *
     * @param url : the url of the soundfile
     * @param audioCtx : the audio context
     * @returns : the audio data
     */
    private static async fetchSoundfile(
        url: string,
        audioCtx: BaseAudioContext
    ): Promise<AudioData> {
        console.log(`Loading sound file from ${url}`);
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(
                `Failed to load sound file from ${url}: ${response.statusText}`
            );
        // Decode the audio data
        const arrayBuffer = await response.arrayBuffer();
        if (this.isWaveFile(arrayBuffer)) {
            try {
                return this.decodeWaveFile(arrayBuffer);
            } catch (error) {
                console.error(error);
            }
        }
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        return this.toAudioData(audioBuffer);
    }

    /**
     * Load the soundfile.
     *
     * @param filename : the filename
     * @param metaUrls : the metadata URLs
     * @param soundfiles : the soundfiles
     * @param audioCtx : the audio context
     */
    private static async loadSoundfile(
        filename: string,
        metaUrls: string[],
        soundfiles: LooseFaustDspFactory['soundfiles'],
        audioCtx: BaseAudioContext
    ): Promise<void> {
        if (soundfiles?.[filename]) return;
        const urlsToCheck = [
            filename,
            ...[...metaUrls, ...this.fallbackPaths].map(
                (path) =>
                    new URL(filename, path.endsWith('/') ? path : `${path}/`)
                        .href
            )
        ];
        // Try each candidate once to avoid double downloads (no preflight GET).
        let lastError: unknown = null;
        for (const url of urlsToCheck) {
            try {
                soundfiles![filename] = await this.fetchSoundfile(
                    url,
                    audioCtx
                );
                return;
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(
            `Failed to load sound file ${filename}, all check failed. Last error: ${String(lastError)}`
        );
    }

    /**
     * Load the soundfiles, public API.
     *
     * @param dspMeta : the metadata
     * @param soundfilesIn : the soundfiles
     * @param audioCtx : the audio context
     * @returns : the soundfiles
     */
    static async loadSoundfiles(
        dspMeta: FaustDspMeta,
        soundfilesIn: LooseFaustDspFactory['soundfiles'],
        audioCtx: BaseAudioContext
    ): Promise<LooseFaustDspFactory['soundfiles']> {
        const metaUrls = FaustBaseWebAudioDsp.extractUrlsFromMeta(dspMeta);
        const soundfiles = this.findSoundfilesFromMeta(dspMeta);
        for (const id in soundfiles) {
            if (soundfilesIn?.[id]) {
                soundfiles[id] = soundfilesIn[id];
                continue;
            }
            try {
                await this.loadSoundfile(id, metaUrls, soundfiles, audioCtx);
            } catch (error) {
                console.error(error);
            }
        }
        return soundfiles;
    }
}

export default SoundfileReader;
