# Kotoba — Product Spec & Roadmap

A Chrome extension for learning Japanese vocabulary **while you browse**: a personal word bank,
flashcards that pop up on the page you're reading, and (from v2) a reader that recognises your
words on any Japanese website.

This document is the source of truth for **what** each version does and **when it's done**.
Each version builds on the previous one and ships on its own.

| Version | Theme | Status |
|---|---|---|
| **v1** | Kotoba — word bank + popup flashcards | ✅ Done |
| **v2** | Reader — highlight words you've collected on any web page | 🟡 Built, in testing (`feature/reader-highlight`) |
| **v3** | Furigana on pages — readings above kanji on any page | 🟡 Built, in testing (`feature/furigana`) |
| **v4** | Sentence mining — add words from the web in one click | ⬜ Planned |
| **v5** | Polish — shortcuts, per-site rules, stats | ⬜ Planned |
| **Release** | Public release track (runs alongside v2–v3) | ⬜ Planned |

---

## Principles

1. **Your data stays yours.** Everything lives in the browser (IndexedDB + `chrome.storage.local`).
   No account, no server, no tracking. Backup = export JSON.
2. **Never break the page.** Content scripts render in Shadow DOM or via the CSS Custom Highlight
   API — the host page's DOM and layout are never modified.
3. **Learn from real content.** Every feature should shorten the loop
   *read → don't know → look up → save → review → recognise it next time.*
4. **Quiet by default.** Popups, highlights and hovers must be easy to ignore and easy to switch off.
5. **English UI.** All interface text is English. Word meanings are whatever the user writes.

## Non-goals

- Multi-device sync or a backend.
- A full SRS scheduler (FSRS/Anki). The lightweight weighted picker stays.
- Grammar explanations, translation of whole sentences, or machine translation.
- Mobile browsers.

---

## v1 — Kotoba ✅

**Goal:** one place for every word you've met, with flashcards that interrupt you just enough.

### Features
- **Word bank** (IndexedDB `words`): kanji, reading, meaning, example, notes, collections,
  per-word review stats. Status derived from reviews: *New → Learning → Mastered* (3 in a row).
- **Collections**: a word can belong to many; rename, reorder (drag), delete (unlinks, never deletes words).
- **On-page flashcard**: shows on the active tab every N minutes. Classic (reveal → Know/Forgot) or
  Tiered (hint → 3 grades). Snooze, drag to place, tap a kanji for its readings.
- **Study tab**: focused session over all eligible words, both directions
  (Kanji → Meaning and Meaning → Kanji, tracked separately), undo, pause, session results.
- **Words tab**: search, filter by status/collection, bulk add to collection, toggle "in rotation".
- **Kanji tab**: every kanji across your words, on'yomi/kun'yomi (KANJIDIC2), your own meaning/notes.
- **Graph tab**: kanji ↔ word graph.
- **Toolbar popup**: totals, show a card now, quick-add a word.
- **Settings**: light/dark/system, 4 accent themes, card position, frequency.
- **Backup**: export/import JSON (import backs up first if it would overwrite).

### Hidden for now
- Google Sheets deck sync (Settings → Add deck / Sync all). Code is intact; UI hidden with `hidden`.

---

## v2 — Reader: highlight what you know 🟡

**Goal:** open any Japanese page and instantly see which words you've already collected.

### Requirements
- R2.1 Words from the bank are underlined on any page that contains Japanese text.
  Colour = status (indigo New, amber Learning, green Mastered).
- R2.2 **Exact** matches are solid; **similar forms** (probably conjugated) are dashed.
  Similar = the word's stem followed directly by hiragana (食べ|た → 食べる, 行|った → 行く).
- R2.3 Noise rules: longest match wins · only words containing kanji · a one-kanji word only
  matches when its neighbours aren't kanji (雨 in 雨が, not in 雨天) · per-word mute.
- R2.4 Hovering a highlight shows a card instantly: status, reading, meaning,
  "similar form" note when relevant, and *Don't highlight*.
- R2.5 Works on dynamic pages (infinite scroll, SPAs) and stays smooth on long pages.
- R2.6 Settings: on/off, which statuses, clear muted words. Changes apply without reloading the page.
- R2.7 The page DOM is never modified (CSS Custom Highlight API).

### Done when
- [x] Unit tests for the matcher pass (`node --test tests/*.test.js`).
- [x] `tests/reader-test.html` behaves as each section describes.
- [x] Hover card appears instantly and follows the cursor between words.
- [x] Words split by `<ruby>` (e.g. NHK News Easy) or other inline tags still match — readings in `<rt>` are ignored and never underlined.
- [ ] Verified on: NHK News Easy, Japanese Wikipedia, a news site, Twitter/X.

### Known limits
- Text inside iframes isn't scanned.
- A similar form is a hint, not a guarantee (生きる and 生まれる share 生).

---

## v3 — Furigana on pages 🟡

**Goal:** never get stuck on a kanji. Switch it on and every kanji on the page gets its reading
above it, in context.

### Requirements
- R3.1 **Tokenizer**: kuromoji.js (Apache 2.0) + mecab-ipadic, runs in the background service
  worker. Readings come from the sentence, so 今日 → きょう and 行った → い.
- R3.2 **Dictionary**: ~18 MB gzipped, not in the extension zip. Downloaded once on first use from
  the GitHub Release `dict-ipadic-v1`, stored in IndexedDB (`kotobaDict`). Settings shows status,
  size and progress, with *Download / Remove*.
- R3.3 Readings go only over the kanji, never over okurigana (食<rt>た</rt>べる).
- R3.4 Pages are changed (real `<ruby>` elements), but turning it off puts back the original text
  nodes, so the page is exactly as before.
- R3.5 Only text near the viewport is processed; new content (infinite scroll, SPAs) is picked up.
- R3.6 Skipped: existing `<ruby>`, form fields, editable areas, `code`/`pre`.
- R3.7 Readings are excluded when copying text.
- R3.8 Works with the v2 highlights: bank words stay underlined and keep their hover card.

### Done when
- [x] Readings correct on a test paragraph (今日, 行った, 映画館, 三ヶ月) and on ja.wikipedia.org.
- [x] Turning it off restores the page HTML byte for byte.
- [x] Highlights + furigana together: 映画館 underlined across 映画|館 ruby pieces, hover card works.
- [ ] Attribution for kuromoji / mecab-ipadic in Settings and README (done) and NOTICE in the dict release.

### Later
- Hover any word (not just bank words) for its meaning, via JMdict. Would also feed v4's
  *Add to Kotoba*.
- Option to hide furigana on words you've mastered.

---

## v4 — Sentence mining ⬜

**Goal:** turn "I didn't know that word" into a flashcard in one click.

### Requirements
- R4.1 **+ Add to Kotoba** on the hover card. Kanji, reading and meaning pre-filled from the
  dictionary (meaning editable before saving — e.g. translate to your own language).
- R4.2 The **sentence** the word was found in is saved as the word's example, plus the page URL.
- R4.3 Pick collection(s) and "in rotation" inline; last-used collection is remembered.
- R4.4 Newly added words highlight on the current page immediately.
- R4.5 Duplicate handling matches the Add word form (merge / update prompt).

### Done when
- [ ] From hover to saved word in ≤ 2 clicks, without leaving the page.
- [ ] The saved example sentence is trimmed to one sentence (。！？ boundaries).

---

## v5 — Polish ⬜

- Keyboard shortcut to toggle the reader (`chrome.commands`).
- Per-site rules: always off on chosen sites; on only for Japanese pages.
- [x] Toolbar popup: live countdown to the next pop-up card (snooze- and pending-card-aware), quick on/off for pop-up cards and for the reader highlight.
- Encounter stats: "seen on the web N times" per word, words met this week.
- Optional: highlight style (underline / background / dot).

---

## Release track ⬜

Runs alongside v2–v3; the first public release is **v1 + v2** (v3 can follow as an update).

- [ ] Merge the current line (`2.0-Kotoba-Bank`) into `master`.
- [ ] English `README.md`: what it is, screenshots/GIF, install, privacy, credits.
- [ ] `LICENSE` for the code + data attribution (KANJIDIC2 / JMdict, CC BY-SA 4.0).
- [ ] Versioning: `manifest.json` version = git tag (`v1.0.0`), changelog in each GitHub Release.
- [ ] Packaging script: zip only the files the extension needs (no tests/docs/dev files).
- [ ] GitHub Release with the zip + install steps (Load unpacked).
- [ ] Landing page (GitHub Pages from `/docs`): hero, feature sections per version, install, privacy.
- [ ] Chrome Web Store listing (optional): screenshots, privacy policy page, permission justification
      for `<all_urls>` (needed for the on-page flashcard and the reader).
