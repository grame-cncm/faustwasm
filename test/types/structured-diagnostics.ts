import {
    FaustCompilerError,
    type FaustDiagnosticReport,
    type IFaustCompiler
} from '../../src/index.js';

export async function compileWithDiagnostics(
    compiler: IFaustCompiler,
    source: string
) {
    try {
        const factory = await compiler.createMonoDSPFactory(
            'typed-example.dsp',
            source,
            '--warn'
        );
        const successReport: FaustDiagnosticReport | null =
            compiler.getDiagnostics();
        return { factory, successReport };
    } catch (error) {
        if (!(error instanceof FaustCompilerError)) throw error;
        const report = error.getErrorDiagnostics();
        const first = report?.diagnostics[0];
        const primary = first?.labels.find(({ style }) => style === 'primary');
        return {
            factory: null,
            successReport: null,
            failure: {
                code: first?.code,
                range: primary?.range,
                facts: first?.facts,
                fixes: first?.fixes
            }
        };
    }
}
