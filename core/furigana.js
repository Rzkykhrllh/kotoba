// furigana.js — turn tokenizer output into ruby segments. Pure functions, no
// DOM and no chrome.* APIs, so they're shared by background.js (which runs the
// tokenizer) and the node unit tests (tests/furigana.test.js).
//
//   furiSegments("食べる", "たべる")  -> [{ t: "食", r: "た" }, { t: "べる" }]
//   furiSegments("映画館", "えいがかん") -> [{ t: "映画館", r: "えいがかん" }]
//   furiSegments("ひらがな", "ひらがな") -> null   (no kanji, nothing to annotate)
//
// The reading is lined up with the word by treating every kana run in the
// word as a fixed anchor and every kanji run as a gap to fill, so okurigana
// (the べる in 食べる) never gets a reading above it.

const FURI_KANJI_RE = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;

function furiHasKanji(s) {
  return FURI_KANJI_RE.test(s);
}

// Katakana → hiragana (ー and other marks are left alone).
function furiToHiragana(s) {
  return String(s || "").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function furiSegments(surface, reading) {
  if (!surface || !furiHasKanji(surface)) return null;
  const r = furiToHiragana(reading);
  if (!r || r === "*") return null;

  // Split into alternating runs: { kanji: true/false, t }.
  const runs = [];
  for (const ch of surface) {
    const k = FURI_KANJI_RE.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.kanji === k) last.t += ch;
    else runs.push({ kanji: k, t: ch });
  }

  if (runs.length > 1) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = "^" + runs.map((x) => (x.kanji ? "(.+?)" : esc(furiToHiragana(x.t)))).join("") + "$";
    const m = new RegExp(pattern).exec(r);
    if (m) {
      let g = 1;
      return runs.map((x) => (x.kanji ? { t: x.t, r: m[g++] } : { t: x.t }));
    }
  }
  // One kanji run, or the reading doesn't line up with the kana in the word
  // (irregular readings like 今日 → きょう are fine, they're one run): put the
  // whole reading over the whole word.
  if (furiToHiragana(surface) === r) return null;
  return [{ t: surface, r }];
}

// kuromoji tokens → [{ s, e, segs }] for each token that needs furigana.
// s/e are offsets into the tokenized string.
function furiFromTokens(tokens) {
  const out = [];
  let pos = 0;
  for (const tk of tokens) {
    const surface = tk.surface_form || "";
    const segs = furiSegments(surface, tk.reading);
    if (segs) out.push({ s: pos, e: pos + surface.length, segs });
    pos += surface.length;
  }
  return out;
}

if (typeof module !== "undefined") module.exports = { furiSegments, furiFromTokens, furiToHiragana, furiHasKanji };
