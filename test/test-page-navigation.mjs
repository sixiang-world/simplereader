import assert from 'node:assert/strict';
import {pageForLine} from '../shared/core/text/page-navigation.js';
for(const [line,expected] of [[-1,1],[0,1],[9,1],[10,2],[19,2],[20,3],[999,3]])assert.equal(pageForLine(line,[0,10,20]),expected);
assert.equal(pageForLine(NaN,[0,10]),1);assert.equal(pageForLine(0,[]),1);assert.equal(pageForLine(20,[0,10,20],2),2);
console.log('Shared page navigation: exact boundaries, final page, invalid/empty input and clamp passed');
