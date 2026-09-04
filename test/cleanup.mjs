/**
 * Remove what a test run leaves behind.
 *
 * The CLI tests build into `test/out`, one directory per case, and the sensor
 * test bundles an internal module there. None of it is worth keeping once the
 * run is over, and leaving it around is how a scratch file ends up somewhere
 * it should not be -- inside a published tarball, or in a stale state the next
 * run reads by accident.
 *
 * Wired as `posttest` and `posttest-cli`, so it runs after a successful suite.
 * npm does not run a post hook when the script failed, which is deliberate
 * here: a failing case is much easier to look into with its output still on
 * disk.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'out');

if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
    console.log(`Removed ${path.relative(ROOT, OUT)}`);
}
