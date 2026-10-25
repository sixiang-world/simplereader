import { FILE_EXTENSION_REGEX } from "../config/file-types.js";
/** Preserve the existing supported-extension behavior without DOM imports. */
export function removeFileExtension(filename) { return filename.replace(FILE_EXTENSION_REGEX, ""); }
