//@ts-check
import * as fs from "fs";
import * as path from "path";

/**
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
*/

/**
 * @param {string} src - The source path.
 * @param {string} dest - The destination path.
 */
const cpSync = (src, dest) => {
    if (!fs.existsSync(src)) return;
    if (fs.lstatSync(src).isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(child => cpSync(path.join(src, child), path.join(dest, child)));
    } else {
        fs.copyFileSync(src, dest);
    }
};

/**
 * @param {string} src - The source path of the file to modify and copy.
 * @param {string} dest - The destination path.
 * @param {string} find - The string to find.
 * @param {string} replace - The string to replace.
 */
const cpSyncModify = (src, dest, find, replace) => {
    fs.readFile(src, 'utf8', function (err, data) {
        if (err) {
            console.error(err);
            return;
        }

        // Create a regular expression from the 'find' string
        const regex = new RegExp(find, 'g');

        // Replace 'find' with 'replace'
        let modifiedData = data.replace(regex, replace);

        // Write the modified data to a new file
        fs.writeFile(dest, modifiedData, 'utf8', function (err) {
            if (err) {
                console.error(err);
            }
        });
    });
}
/**
 * @param {string} dir - The directory to remove.
 */
const rmSync = (dir) => {
    if (!fs.existsSync(dir)) return;
    if (fs.lstatSync(dir).isDirectory()) {
        fs.readdirSync(dir).forEach(child => rmSync(path.join(dir, child)));
        fs.rmdirSync(dir);
    } else {
        fs.unlinkSync(dir);
    }
};

export { cpSync, cpSyncModify, rmSync };
