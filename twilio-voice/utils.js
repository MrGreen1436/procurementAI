/**
 * twilio-voice/utils.js
 *
 * Price extraction utility.
 *
 * extractPrice(text) attempts to find a dollar amount in a natural-language
 * string like:
 *   "fifty five dollars"         → 55
 *   "one hundred and twenty five" → 125
 *   "$42.50"                     → 42.5
 *   "42 50"                      → 42.5  (ambiguous; treated as 42.50)
 *   "twenty dollars per unit"    → 20
 *
 * Strategy (applied in order):
 *   1. Numeric pattern  — digits (with optional $ prefix, decimals, commas)
 *   2. Word-based NLP   — maps English number words → numeric value
 *
 * Returns the first match as a float, or null if nothing found.
 */

'use strict';

// ── Numeric pattern: matches $1,234.56 or 1234.56 or 42 ─────────────────────
const NUMERIC_PRICE_REGEX = /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;

// ── Word-to-number mapping ────────────────────────────────────────────────────
const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

const MULTIPLIERS = {
  hundred: 100,
  thousand: 1000,
};

/**
 * Converts a string of English number words to a numeric value.
 * Handles patterns like "one hundred and twenty five", "fifty", "two thousand".
 *
 * @param {string} text
 * @returns {number|null}
 */
function wordsToNumber(text) {
  // Normalise: lowercase, strip "dollars", "dollar", "each", "per unit" etc.
  const cleaned = text
    .toLowerCase()
    .replace(/\bdollars?\b|\bcents?\b|\beach\b|\bper\s+unit\b|\band\b/gi, ' ')
    .trim();

  const tokens = cleaned.split(/\s+/);

  let total   = 0;  // running sum
  let current = 0;  // current chunk (resets after multiplier)

  for (const token of tokens) {
    if (ONES[token] !== undefined) {
      current += ONES[token];
    } else if (TENS[token] !== undefined) {
      current += TENS[token];
    } else if (token === 'hundred') {
      // e.g. "two hundred" → current becomes 200
      current = (current || 1) * MULTIPLIERS.hundred;
    } else if (token === 'thousand') {
      // e.g. "two thousand" → current * 1000 added to total, reset current
      current = (current || 1) * MULTIPLIERS.thousand;
      total  += current;
      current = 0;
    } else if (/^\d+$/.test(token)) {
      // Bare digit token inside a spoken phrase (unusual but handle it)
      current += parseInt(token, 10);
    }
    // Unknown tokens are silently ignored
  }

  total += current;
  return total > 0 ? total : null;
}

/**
 * extractPrice(text)
 *
 * Attempts to extract a numeric dollar price from a transcribed speech string.
 *
 * @param  {string} text  — raw transcribed text from Twilio SpeechResult
 * @returns {number|null} — first extracted price as a float, or null
 */
function extractPrice(text) {
  if (!text || typeof text !== 'string') return null;

  const cleaned = text.trim();

  // ── Decide which strategy to try first ────────────────────────────────────
  // If the input contains a currency symbol ($) or a decimal point, the
  // numeric regex is almost certainly more accurate.  Otherwise the input is
  // likely a spoken English phrase ("fifty five dollars", "one thousand") and
  // the word-parser should run first — otherwise the regex greedily matches
  // single digits buried inside words like "one" → "1".
  const looksNumeric = /[\$\d]/.test(cleaned);

  if (looksNumeric) {
    // ── Strategy 1a: Numeric regex ───────────────────────────────────────────
    const numericMatch = cleaned.match(NUMERIC_PRICE_REGEX);
    if (numericMatch) {
      const priceStr = numericMatch[1].replace(/,/g, '');
      const price    = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) return price;
    }

    // Fall through to word parser as backup
    const wordPrice = wordsToNumber(cleaned);
    if (wordPrice !== null && wordPrice > 0) return wordPrice;

  } else {
    // ── Strategy 1b: Word-based parser first ─────────────────────────────────
    const wordPrice = wordsToNumber(cleaned);
    if (wordPrice !== null && wordPrice > 0) return wordPrice;

    // Fall through to numeric regex as backup (e.g. "42 dollars")
    const numericMatch = cleaned.match(NUMERIC_PRICE_REGEX);
    if (numericMatch) {
      const priceStr = numericMatch[1].replace(/,/g, '');
      const price    = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) return price;
    }
  }

  // ── No price found ─────────────────────────────────────────────────────────
  return null;
}

module.exports = { extractPrice, wordsToNumber };
