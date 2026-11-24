/**
 * Put the results of `npm run bench` into the page that shows them.
 *
 *   npm run bench -- --json results.json
 *   node test/bench/report.mjs results.json            # docs/bench/index.html
 *   node test/bench/report.mjs results.json other.html
 *
 * The page (`docs/bench/index.html`, served by GitHub Pages under
 * /faustwasm/bench/) is self-contained: its data is the JSON in its
 * `<script id="bench-data">`, which this replaces, and it draws everything
 * from that at load time. The individual runs are left out: the page shows
 * the best of them, which is what the bench reports.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);

const [input, output = path.join(ROOT, 'docs', 'bench', 'index.html')] =
    process.argv.slice(2);
if (!input) {
    console.error('usage: node test/bench/report.mjs results.json [page.html]');
    process.exit(1);
}

const {
    environment,
    results,
    failed = []
} = JSON.parse(fs.readFileSync(input, 'utf8'));
const data = {
    environment,
    // JSON.stringify leaves an undefined property out.
    results: results.map((result) => ({ ...result, runs: undefined })),
    failed
};

const OPEN = '<script id="bench-data" type="application/json">';
const page = fs.readFileSync(output, 'utf8');
const start = page.indexOf(OPEN);
const end = page.indexOf('</script>', start);
if (start === -1 || end === -1) {
    console.error(`${output} has no ${OPEN}...</script> to fill`);
    process.exit(1);
}
// `<` escaped, so that no string of the data can close the script element.
const json = JSON.stringify(data, null, 1).replace(/</g, '\\u003c');
fs.writeFileSync(
    output,
    `${page.slice(0, start + OPEN.length)}\n${json}\n${page.slice(end)}`
);
console.log(
    `${path.relative(ROOT, output)}: ${data.results.length} programs, ${environment.date}`
);
