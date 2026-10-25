/** Environment-independent file type constants; kept compatible with existing readers. */
export const SUPPORTED_FILE_EXT = ".txt";
export const SUPPORTED_EPUB_EXT = ".epub";
export const EPUB_FILE_TYPE = "application/epub+zip";
export const SUPPORTED_FONT_EXT = [".ttf", ".otf"];
export const FILE_EXTENSION_REGEX = new RegExp(`(${SUPPORTED_FILE_EXT}|${SUPPORTED_EPUB_EXT}|${SUPPORTED_FONT_EXT.join("|")})$`, "i");
