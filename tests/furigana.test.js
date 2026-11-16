const test = require("node:test");
const assert = require("node:assert/strict");
const { furiSegments, furiFromTokens, furiToHiragana } = require("../core/furigana.js");

test("katakana reading becomes hiragana", () => {
  assert.equal(furiToHiragana("タベル"), "たべる");
  assert.equal(furiToHiragana("コーヒー"), "こーひー");
});

test("no kanji, nothing to annotate", () => {
  assert.equal(furiSegments("ひらがな", "ヒラガナ"), null);
  assert.equal(furiSegments("コーヒー", "コーヒー"), null);
});

test("kanji-only word gets one reading", () => {
  assert.deepEqual(furiSegments("映画館", "エイガカン"), [{ t: "映画館", r: "えいがかん" }]);
});

test("okurigana stays bare", () => {
  assert.deepEqual(furiSegments("食べる", "タベル"), [{ t: "食", r: "た" }, { t: "べる" }]);
  assert.deepEqual(furiSegments("美しかった", "ウツクシカッタ"), [{ t: "美", r: "うつく" }, { t: "しかった" }]);
});

test("kana in the middle splits the reading", () => {
  assert.deepEqual(furiSegments("取り消し", "トリケシ"), [{ t: "取", r: "と" }, { t: "り" }, { t: "消", r: "け" }, { t: "し" }]);
  assert.deepEqual(furiSegments("お茶", "オチャ"), [{ t: "お" }, { t: "茶", r: "ちゃ" }]);
});

test("irregular reading goes over the whole word", () => {
  assert.deepEqual(furiSegments("今日", "キョウ"), [{ t: "今日", r: "きょう" }]);
});

test("reading that doesn't line up falls back to the whole word", () => {
  assert.deepEqual(furiSegments("行った", "オコナッタ"), [{ t: "行", r: "おこな" }, { t: "った" }]);
  assert.deepEqual(furiSegments("ヶ月", "カゲツ"), [{ t: "ヶ月", r: "かげつ" }]);
});

test("missing reading is skipped", () => {
  assert.equal(furiSegments("漢字", undefined), null);
  assert.equal(furiSegments("漢字", "*"), null);
});

test("tokens become offsets into the string", () => {
  const toks = [
    { surface_form: "昨日", reading: "キノウ" },
    { surface_form: "、" , reading: "、" },
    { surface_form: "映画館", reading: "エイガカン" },
    { surface_form: "に", reading: "ニ" },
    { surface_form: "行っ", reading: "イッ" },
    { surface_form: "た", reading: "タ" },
  ];
  assert.deepEqual(furiFromTokens(toks), [
    { s: 0, e: 2, segs: [{ t: "昨日", r: "きのう" }] },
    { s: 3, e: 6, segs: [{ t: "映画館", r: "えいがかん" }] },
    { s: 7, e: 9, segs: [{ t: "行", r: "い" }, { t: "っ" }] },
  ]);
});
