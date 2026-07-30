/**
 * Canonical half-open source range used by diagnostics-v2.
 */
export interface FaustDiagnosticRange {
    source_id: number;
    start: number;
    end: number;
}

/**
 * Immutable source metadata retained by a diagnostics-v2 report.
 */
export interface FaustDiagnosticSource {
    id: number;
    name: string;
    kind: 'file' | 'memory' | 'imported_file' | 'virtual_library';
    content_hash: string;
    text: string | null;
}

export type FaustDiagnosticFactValue =
    | { type: 'string'; value: string }
    | { type: 'integer'; value: number }
    | { type: 'unsigned'; value: number }
    | { type: 'real'; value: string }
    | { type: 'boolean'; value: boolean }
    | { type: 'string_list'; value: string[] }
    | { type: 'integer_range'; min: number; max: number }
    | { type: 'object'; value: Record<string, FaustDiagnosticFactValue> };

export interface FaustDiagnosticLabel {
    style: 'primary' | 'secondary';
    role:
        | 'primary_cause'
        | 'use_site'
        | 'definition_site'
        | 'call_site'
        | 'operator'
        | 'expected_here'
        | 'conflicts_with'
        | 'import_site'
        | 'previous_token'
        | 'matching_delimiter'
        | 'derived_from';
    range: FaustDiagnosticRange | null;
    compatibility_span: {
        file: string;
        line: number;
        col: number;
        end_line: number;
        end_col: number;
    };
    message: string;
}

export interface FaustDiagnosticTrace {
    kind:
        | 'binding'
        | 'import'
        | 'expansion'
        | 'evaluation'
        | 'transformation'
        | 'causal';
    frames: Array<{
        name: string | null;
        range: FaustDiagnosticRange | null;
        ir: { kind: string; id: number } | null;
        description: string;
    }>;
}

export interface FaustDiagnosticFix {
    title: string;
    applicability:
        | 'machine_applicable'
        | 'maybe_incorrect'
        | 'has_placeholders'
        | 'manual';
    edits: Array<{ range: FaustDiagnosticRange; replacement: string }>;
    explanation: string | null;
}

export interface FaustDiagnostic {
    severity: 'error' | 'warning' | 'remark';
    stage:
        | 'source_reader'
        | 'lexer'
        | 'parser'
        | 'eval'
        | 'propagate'
        | 'normalize'
        | 'type_inference'
        | 'transform'
        | 'fir'
        | 'codegen'
        | 'compiler';
    code: string;
    detail_code: string | null;
    category:
        | 'user_code'
        | 'unsupported_feature'
        | 'invalid_options'
        | 'environment'
        | 'cancelled'
        | 'compiler_bug';
    message: string;
    labels: FaustDiagnosticLabel[];
    facts: Record<string, FaustDiagnosticFactValue>;
    traces: FaustDiagnosticTrace[];
    fixes: FaustDiagnosticFix[];
    related: Array<{
        code: string;
        message: string;
        labels: FaustDiagnosticLabel[];
    }>;
    notes: string[];
    help: string[];
    debug: Record<string, FaustDiagnosticFactValue> | null;
}

/**
 * Complete diagnostics-v2 envelope returned by the Rust compiler module.
 *
 * Unknown future properties may be present at runtime and are intentionally
 * preserved when the JSON is parsed.
 */
export interface FaustDiagnosticReport {
    schema_version: 2;
    compiler: { name: 'faust-rs'; version: string; target: string };
    request: {
        mode: string | null;
        backend: string | null;
        normalized_options: string[];
    };
    status: 'success' | 'failed';
    sources: FaustDiagnosticSource[];
    diagnostics: FaustDiagnostic[];
    [key: string]: unknown;
}

/**
 * Error raised for a Faust compiler failure.
 *
 * `message` remains the human compatibility channel.
 * `getErrorDiagnostics()` returns the complete structured report when the
 * loaded compiler module supports it, or `null` for older/C++ modules.
 */
export class FaustCompilerError extends Error {
    private readonly fDiagnostics: FaustDiagnosticReport | null;
    readonly cause?: unknown;

    constructor(
        message: string,
        diagnostics: FaustDiagnosticReport | null,
        cause?: unknown
    ) {
        super(message);
        this.name = 'FaustCompilerError';
        this.fDiagnostics = diagnostics;
        this.cause = cause;
        Object.setPrototypeOf(this, FaustCompilerError.prototype);
    }

    getErrorDiagnostics(): FaustDiagnosticReport | null {
        return this.fDiagnostics;
    }
}

/**
 * Parse a diagnostics-v2 payload defensively.
 *
 * The function validates only the stable envelope discriminator and required
 * collection fields. Unknown fields are retained on the returned object.
 */
export const parseFaustDiagnosticReport = (
    text: string
): FaustDiagnosticReport | null => {
    try {
        const value: unknown = JSON.parse(text);
        if (
            typeof value !== 'object' ||
            value === null ||
            (value as { schema_version?: unknown }).schema_version !== 2 ||
            !Array.isArray((value as { sources?: unknown }).sources) ||
            !Array.isArray((value as { diagnostics?: unknown }).diagnostics)
        ) {
            return null;
        }
        const status = (value as { status?: unknown }).status;
        if (status !== 'success' && status !== 'failed') return null;
        return value as FaustDiagnosticReport;
    } catch {
        return null;
    }
};
