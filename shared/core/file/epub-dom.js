/** Serialize an SVG from either a browser DOM or the build pipeline DOM. */
export function serializeEpubSvg(node) {
    if (!node.getAttribute("xmlns")) node.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (typeof XMLSerializer !== "undefined") return new XMLSerializer().serializeToString(node);
    // linkedom implements outerHTML rather than XMLSerializer. Keep this
    // adapter explicit instead of installing unrelated globals in Node.
    if (typeof node.outerHTML === "string") return node.outerHTML;
    throw new Error("The EPUB DOM adapter cannot serialize SVG");
}
