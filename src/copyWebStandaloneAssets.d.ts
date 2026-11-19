declare const copyWebStandaloneAssets: (
    outputDir: string,
    dspName: string,
    poly?: boolean,
    effect?: boolean
) => void;
declare const copyWebPWAAssets: (
    outputDir: string,
    dspName: string,
    poly?: boolean,
    effect?: boolean
) => void;
declare const copyWebTemplateAssets: (
    outputDir: string,
    dspName: string,
    poly?: boolean,
    effect?: boolean
) => void;

declare const copyWebRemoteAssets: (
    outputDir: string,
    dspName: string,
    poly?: boolean,
    effect?: boolean,
    options?: { signal?: string; iceServers?: string[] }
) => void;

export {
    copyWebStandaloneAssets,
    copyWebPWAAssets,
    copyWebTemplateAssets,
    copyWebRemoteAssets
};
