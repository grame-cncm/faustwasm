import { qrcodegen } from './vendor/qrcodegen';

export interface FaustQrCodeOptions {
    /** Light modules around the code, in modules; 4 is what the standard asks. Default 4. */
    border?: number;
    /** Colour of the dark modules, as CSS. Default `#000`. */
    dark?: string;
    /** Colour of the light modules and the border, as CSS. Default `#fff`. */
    light?: string;
    /** Error correction level. Default `medium`, raised when it costs no size. */
    ecc?: 'low' | 'medium' | 'quartile' | 'high';
}

const LEVELS = {
    low: qrcodegen.QrCode.Ecc.LOW,
    medium: qrcodegen.QrCode.Ecc.MEDIUM,
    quartile: qrcodegen.QrCode.Ecc.QUARTILE,
    high: qrcodegen.QrCode.Ecc.HIGH
};

/** A colour as CSS writes it, and nothing that could leave the attribute. */
const COLOUR = /^[#\w(),.%\s-]+$/;

/**
 * A QR code of a text, as an SVG document: for a host page to show its
 * pairing link, so that a phone opens it by pointing its camera.
 *
 * The text is only encoded, never written into the SVG, so any URL is safe
 * to pass. The SVG scales to any size (one unit per module, crisp edges);
 * give it a width in CSS. The encoder is Project Nayuki's (MIT), vendored in
 * `vendor/qrcodegen.ts`.
 *
 * @throws {RangeError} if the text is too long for a QR code, or a colour is
 * not one
 */
export const qrCodeSvg = (
    text: string,
    options: FaustQrCodeOptions = {}
): string => {
    const border = options.border ?? 4;
    const dark = options.dark ?? '#000';
    const light = options.light ?? '#fff';
    if (!Number.isInteger(border) || border < 0)
        throw new RangeError(`invalid border ${border}`);
    for (const colour of [dark, light])
        if (!COLOUR.test(colour))
            throw new RangeError(`invalid colour ${colour}`);
    const qr = qrcodegen.QrCode.encodeText(
        text,
        LEVELS[options.ecc ?? 'medium']
    );
    const parts: string[] = [];
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            if (qr.getModule(x, y))
                parts.push(`M${x + border},${y + border}h1v1h-1z`);
        }
    }
    const size = qr.size + 2 * border;
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
        `<rect width="${size}" height="${size}" fill="${light}"/>` +
        `<path d="${parts.join('')}" fill="${dark}"/></svg>`
    );
};
