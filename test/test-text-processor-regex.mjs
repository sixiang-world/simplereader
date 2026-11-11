/** Exercise the public metadata and optimizer APIs: no source extraction or silent skip. */
import assert from 'node:assert/strict';
import { TextProcessorCore } from '../shared/core/text/text-processor-core.js';
import { generateAdsRules, isNumberedChineseHeading } from '../shared/core/text/regex-rules.js';
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
for (const heading of ['第一回', '第 12 回：桃園結義', '第１２回　桃園結義', '第一〇回　兩軍相遇', '第一○二回：再戰', '第貳回 回目']) {
    assert.ok(TextProcessorCore.getTitle(heading)[0], `TXT heading not recognized: ${heading}`);
    assert.ok(isNumberedChineseHeading(heading), `EPUB heading not recognized: ${heading}`);
    cases++;
}
for (const prose of ['他在第一回已經出現。', '第一回見面時，他還不認得我。']) {
    assert.equal(TextProcessorCore.getTitle(prose)[0], '');
    assert.equal(isNumberedChineseHeading(prose), false);
    cases++;
}
assert.equal(isNumberedChineseHeading('第一回：這是一整句正文。'), false);
console.log(`${cases + 1} public text-processing regex behavior cases passed, 0 skipped`);
