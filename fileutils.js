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
    if (!fs.existsSync(src)) {
        console.error(`${src} does not exist.`)
        return;
    }
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
 * @param {string[]} findAndReplace - The string to find and to replace pairs.
 */
const cpSyncModify = (src, dest, ...findAndReplace) => {
    if (!fs.existsSync(src)) {
        console.error(`${src} does not exist.`)
        return;
    }
    let data = fs.readFileSync(src, "utf-8");
    for (let i = 0; i < findAndReplace.length; i += 2) {
        const find = findAndReplace[i];
        const replace = findAndReplace[i + 1];
        // Create a regular expression from the 'find' string
        const regex = new RegExp(find, "g");
        // Replace 'find' with 'replace'
        data = data.replace(regex, replace);
    }
    // Write the modified data to a new file
    fs.writeFileSync(dest, data, "utf-8");
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
