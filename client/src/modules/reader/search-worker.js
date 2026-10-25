import { findMatchingLine } from "./search-matcher.js";

self.onmessage = ({ data }) => {
    try {
        self.postMessage({ result: findMatchingLine(data.lines, data.pattern) });
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
