/**
 * twilio-voice/utils.test.js
 *
 * Minimal self-contained tests for the price extraction utility.
 * Run with: node utils.test.js
 * (No test framework needed — pure Node.js assertions)
 */

'use strict';

const assert = require('assert');
const { extractPrice } = require('./utils');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✅  ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${description}`);
    console.error(`     Expected: ${err.expected} | Got: ${err.actual}`);
    failed++;
  }
}

console.log('\n── Numeric patterns ─────────────────────────────────────');
test('Bare integer',          () => assert.strictEqual(extractPrice('42'), 42));
test('Dollar sign prefix',    () => assert.strictEqual(extractPrice('$55'), 55));
test('Decimal price',         () => assert.strictEqual(extractPrice('$42.50'), 42.5));
test('With commas',           () => assert.strictEqual(extractPrice('$1,250'), 1250));
test('Sentence with number',  () => assert.strictEqual(extractPrice('Our price is $99.99 per unit'), 99.99));
test('Number at end',         () => assert.strictEqual(extractPrice('Best price 75'), 75));

console.log('\n── Word-based numbers ───────────────────────────────────');
test('Simple word',           () => assert.strictEqual(extractPrice('fifty'), 50));
test('Compound word',         () => assert.strictEqual(extractPrice('fifty five'), 55));
test('With dollars suffix',   () => assert.strictEqual(extractPrice('fifty five dollars'), 55));
test('Hundred',               () => assert.strictEqual(extractPrice('one hundred'), 100));
test('Hundred and compound',  () => assert.strictEqual(extractPrice('one hundred and twenty five'), 125));
test('Two hundred fifty',     () => assert.strictEqual(extractPrice('two hundred fifty'), 250));
test('Thousand',              () => assert.strictEqual(extractPrice('one thousand'), 1000));

console.log('\n── Edge cases ───────────────────────────────────────────');
test('Empty string → null',   () => assert.strictEqual(extractPrice(''),    null));
test('null input → null',     () => assert.strictEqual(extractPrice(null),  null));
test('No number → null',      () => assert.strictEqual(extractPrice('hello world'), null));

console.log(`\n── Results: ${passed} passed, ${failed} failed ───────────────────\n`);
if (failed > 0) process.exit(1);
