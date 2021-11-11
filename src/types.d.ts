export type FaustModuleFactory = EmscriptenModuleFactory<FaustModule>;

export interface FaustModule extends EmscriptenModule {
    cwrap: typeof cwrap;
    UTF8ArrayToString(u8Array: number[], ptr: number, maxBytesToRead?: number): string;
    stringToUTF8Array(str: string, outU8Array: number[], outIdx: number, maxBytesToWrite: number): number;
    UTF8ToString: typeof UTF8ToString;
    UTF16ToString: typeof UTF16ToString;
    UTF32ToString: typeof UTF32ToString;
    stringToUTF8: typeof stringToUTF8;
    stringToUTF16: typeof stringToUTF16;
    stringToUTF32: typeof stringToUTF32;
    allocateUTF8: typeof allocateUTF8;
    lengthBytesUTF8: typeof lengthBytesUTF8;
    lengthBytesUTF16: typeof lengthBytesUTF16;
    lengthBytesUTF32: typeof lengthBytesUTF32;
    FS: typeof FS;
}
