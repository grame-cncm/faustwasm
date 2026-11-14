import type FaustCompiler from './FaustCompiler';

/**
 * Where and how to show a diagram with {@link FaustSvgDiagrams.display}.
 */
export interface FaustSvgDisplayOptions {
    /** the file to show, `process.svg` by default */
    file?: string;
    /** for a steppable diagram (`-sst`): the use of the diagram to show, the first by default */
    use?: number;
    /** for a steppable diagram: the (absolute) sample to show, the first by default */
    n?: number;
    /** called after each diagram is shown, the first and the ones links lead to */
    onShow?: (svg: SVGSVGElement, file: string) => void;
}

interface IFaustSvgDiagrams {
    /**
     * Generates auxiliary files from Faust code. The output depends on the compiler options.
     *
     * @param name - the DSP's name
     * @param code - Faust code
     * @param args - compilation args
     * @returns the svg diagrams as a filename - svg string map
     */
    from(name: string, code: string, args: string): Record<string, string>;
}

class FaustSvgDiagrams implements IFaustSvgDiagrams {
    private compiler: FaustCompiler;

    constructor(compiler: FaustCompiler) {
        this.compiler = compiler;
    }

    from(name: string, code: string, args: string) {
        const fs = this.compiler.fs();
        try {
            const files: string[] = fs.readdir(`/${name}-svg/`);
            files
                .filter((file) => file !== '.' && file !== '..')
                .forEach((file) => fs.unlink(`/${name}-svg/${file}`));
        } catch {
            // No previous diagram directory to clear: nothing to do.
        }
        const success = this.compiler.generateAuxFiles(
            name,
            code,
            `-lang wasm -o binary -svg ${args}`
        );
        if (!success) throw new Error(this.compiler.getErrorMessage());
        const svgs: Record<string, string> = {};
        const files: string[] = fs.readdir(`/${name}-svg/`);
        files
            .filter((file) => file !== '.' && file !== '..')
            .forEach(
                (file) =>
                    (svgs[file] = fs.readFile(`/${name}-svg/${file}`, {
                        encoding: 'utf8'
                    }) as string)
            );
        return svgs;
    }

    /**
     * Shows a diagram of a set produced by {@link from} in a container of the page, and follows
     * its links to the other diagrams of the set. With a steppable set (`-sst <n>` in the args
     * of `from`), the diagram's own player is started: values on the wires, stepping, table;
     * its links name the use of the target diagram, which is shown at the current sample.
     * Browser only.
     *
     * @param container - the element the diagram replaces the content of
     * @param svgs - the diagrams, as returned by {@link from}
     * @param options - which file, use and sample to show, and a callback
     * @returns the shown `<svg>` element
     */
    static display(
        container: HTMLElement,
        svgs: Record<string, string>,
        options: FaustSvgDisplayOptions = {}
    ): SVGSVGElement {
        const file = options.file || 'process.svg';
        const text = svgs[file];
        if (text === undefined) throw new Error(`No diagram named ${file}`);
        container.innerHTML = text.replace(/^<\?xml[^>]*\?>\s*/, '');
        const svg = container.querySelector('svg');
        if (!svg) throw new Error(`${file} holds no <svg> element`);
        const show = (target: { file: string; use?: number; n?: number }) =>
            FaustSvgDiagrams.display(container, svgs, {
                ...options,
                ...target
            });
        const player = svg.querySelector('script.faust-svg-step');
        if (player) {
            // innerHTML runs no script: the player is evaluated once, then started on the
            // diagram, which hands its links back through onNavigate
            const scope = globalThis as any;
            if (!scope.FaustSvgStep) new Function(player.textContent || '')();
            scope.FaustSvgStep(svg, {
                use: options.use,
                n: options.n,
                onNavigate: show
            });
        } else {
            for (const a of Array.from(svg.querySelectorAll('a'))) {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    const href =
                        a.getAttributeNS(
                            'http://www.w3.org/1999/xlink',
                            'href'
                        ) ||
                        a.getAttribute('href') ||
                        '';
                    show({ file: href.split('#')[0] });
                });
            }
        }
        options.onShow?.(svg, file);
        return svg;
    }
}

export default FaustSvgDiagrams;
