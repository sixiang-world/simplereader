#!/usr/bin/env node
/**
 * Generate a comprehensive trad→simp character mapping table by querying
 * the opencc-js converter for every CJK Unified Ideograph.
 *
 * This produces a map with ~3000-5000 one-to-one pairs (the spec target)
 * sourced from OpenCC's authoritative dictionary data.
 *
 * One-to-many mappings (where one trad char maps to different simp chars
 * depending on vocabulary context) are SKIPPED — we only keep pairs where
 * the trad char's conversion is unambiguous at the character level. This
 * is the same restriction as the hand-curated map, but now sourced from
 * OpenCC instead of manually maintained.
 *
 * Run: node build-tools/generate-t2s-map-from-opencc.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OpenCC = require("opencc-js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "client", "src", "core", "t2s-map.json");

// Create a converter that does Traditional → Simplified.
const convert = OpenCC.Converter({ from: "tw", to: "cn" });

// Iterate over the CJK Unified Ideographs block (U+4E00 – U+9FFF).
// This is the main block; Extension blocks (U+3400+, U+20000+) are rare
// enough that we skip them for build-time performance.
const CJK_START = 0x4e00;
const CJK_END = 0x9fff;

const map = {};
let skipped = 0;

for (let cp = CJK_START; cp <= CJK_END; cp++) {
    const trad = String.fromCodePoint(cp);

    // Convert this single character.
    const simp = convert(trad);

    // Skip identity mappings (no conversion needed).
    if (simp === trad) continue;

    // Skip one-to-many mappings: if converting a single trad char produces
    // multiple chars, it means the conversion is context-dependent. The
    // light mode (which uses this map) is character-level only and would
    // produce wrong results for these. Heavy mode (OpenCC) handles them
    // correctly via vocabulary lookup.
    if (simp.length !== 1) {
        skipped++;
        continue;
    }

    // Skip if the simp char is also a trad char that maps to something
    // else (chained mapping). This would create ambiguity. In practice
    // this is rare for one-to-one pairs, but we check defensively.
    // Note: we do this in a second pass to avoid O(n²) here.

    map[trad] = simp;
}

console.log(`Generated ${Object.keys(map).length} one-to-one trad→simp pairs`);
console.log(`Skipped ${skipped} one-to-many mappings (use heavy mode for these)`);

// Second pass: remove chained mappings (k→v where v is also a key that
// maps to something else). These create ambiguity in light mode.
let chained = 0;
for (const [k, v] of Object.entries(map)) {
    if (k !== v && v in map && map[v] !== v) {
        // k → v → map[v]: the simp form v is itself a trad char that
        // converts further. Drop k from the map — the heavy mode will
        // handle it correctly.
        delete map[k];
        chained++;
    }
}
if (chained > 0) {
    console.log(`Removed ${chained} chained mappings (k→v→w)`);
}

// Sort keys for stable diffs.
const sorted = {};
for (const k of Object.keys(map).sort()) {
    sorted[k] = map[k];
}

fs.writeFileSync(OUT_PATH, JSON.stringify(sorted, null, 0) + "\n", "utf-8");
console.log(`Wrote ${OUT_PATH} (${fs.statSync(OUT_PATH).size} bytes)`);
