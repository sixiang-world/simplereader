/** Exercise the public metadata and optimizer APIs: no source extraction or silent skip. */
import assert from 'node:assert/strict';
import { TextProcessorCore } from '../shared/core/text/text-processor-core.js';
import { generateAdsRules } from '../shared/core/text/regex-rules.js';
const names = ['Book (Special Edition)', 'Book [Translator]', 'Book {Limited}', 'v1.0 Release', 'C* Programming', 'A+B', 'A?B', '^start', 'end$', 'A|B', 'C\\path', 'Normal Book Title', 'Book (Vol. 1) [Special] {Limited}', '中文（特别版）'];
let cases = 0;
for (const name of names) {
    const info = TextProcessorCore.getBookNameAndAuthor(`${name} by Author [X].txt`);
    for (const [literal, pattern] of [[info.bookName,info.bookNameRE], [info.author,info.authorRE]]) {
        const regex = new RegExp(`^(?:${pattern})$`, 'u');
        assert.ok(regex.test(literal),`escaped metadata must match itself: ${literal}`);
        assert.ok(!regex.test(literal+'extra'),'escaped metadata must not consume suffixes');
        if (literal.includes('.')) assert.equal(regex.test(literal.replace('.', 'Z')),false,'dot must be literal');
    }
    for (const getRules of Object.values(generateAdsRules(info))) {
        const rules = getRules();
        assert.ok(rules.length > 0);
        for (const rule of rules) assert.doesNotThrow(()=>new RegExp(rule,'i'));
    }
    assert.doesNotThrow(()=>TextProcessorCore.optimize('Ordinary body text 123',info));
    cases++;
}
console.log(`${cases} public text-processing regex behavior cases passed, 0 skipped`);
