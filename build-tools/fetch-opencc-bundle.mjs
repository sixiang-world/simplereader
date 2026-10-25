/** Materialize the browser bundle from the integrity-checked, locked npm package.
 * No CDN fallback: missing dependencies fail installation. Reinstall replaces
 * stale browser copies when the installed dependency changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "node_modules/opencc-js/dist/umd/full.js");
const destination = path.join(root, "client/lib/opencc/full.js");
try {
    const bytes = fs.readFileSync(source);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bytes)) {
        fs.writeFileSync(destination, bytes);
        console.log("[opencc] Copied locked dependency bundle to client/lib/opencc/full.js");
    } else {
        console.log("[opencc] Browser bundle matches the locked dependency.");
    }
} catch (error) {
    console.error("[opencc] Cannot copy node_modules/opencc-js/dist/umd/full.js. Install the locked dependency first.");
    console.error(error.message);
    process.exitCode = 1;
}
