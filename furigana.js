/*
 * furigana.js — "Furigana on pages": small readings above the kanji in any
 * Japanese text, e.g. <ruby>映画館<rt>えいがかん</rt></ruby>.
 *
 * - Tokenizing happens in background.js (kuromoji + core/furigana.js); this
 *   file only finds text, sends it over ("furiganaAnnotate"), and swaps each
 *   text node for the same text with <ruby> around the kanji.
 * - Unlike reader.js this DOES change the page (ruby needs real elements), so
 *   it's careful to be undoable: every replaced text node is remembered and
 *   put back as the very same node when furigana is turned off.
 * - Only text near the viewport is processed (IntersectionObserver), so a
 *   long page costs nothing until you scroll to it.
 * - Text the page already shows furigana for (<ruby>), form fields, editable
 *   areas and code are left alone.
 */
(() => {
  if (window.__kotobaFuriLoaded) return;
  window.__kotobaFuriLoaded = true;

  const KANJI_RE = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "TEMPLATE",
    "SVG", "CANVAS", "IFRAME", "CODE", "PRE", "KBD", "SAMP", "RUBY", "RT", "RP"]);
  const MAX_BATCH_CHARS = 6000;

  let on = false;
  const ours = new WeakSet();   // nodes this script created (text + <ruby>)
  let groups = new Set();       // { orig: Text, nodes: Node[] } — one per swapped-out text node
  const groupOf = new WeakMap(); // orig Text -> its group
  let io = null;                // IntersectionObserver over parents of candidate text
  let watched = new WeakSet();  // elements currently observed by `io`

  function send(message) {
    return new Promise((resolve) => {
      try { chrome.runtime.sendMessage(message, (r) => { void chrome.runtime.lastError; resolve(r); }); }
      catch (_) { resolve(null); } // extension reloaded — this content script is orphaned
    });
  }

  function ensureStyles() {
    if (ensureStyles.done) return;
    ensureStyles.done = true;
    // user-select: none keeps the readings out of copied text.
    // ruby-align: center keeps the kanji (and the reading) from being spread
    // out when one is wider than the other.
    const css = "ruby.kotoba-furi { ruby-align: center; } ruby.kotoba-furi > rt { font-size: .5em; font-weight: normal; font-style: normal; letter-spacing: 0;" +
      " text-transform: none; opacity: .8; user-select: none; -webkit-user-select: none; }";
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (_) {
      const style = document.createElement("style");
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  /* ---------------------------- finding text ---------------------------- */

  function accept(node) {
    if (ours.has(node) || !KANJI_RE.test(node.data)) return false;
    const p = node.parentElement;
    if (!p || SKIP_TAGS.has(p.tagName.toUpperCase())) return false;
    if (p.closest("ruby, pre, code, textarea, [contenteditable=''], [contenteditable='true']")) return false;
    return true;
  }

  // Observe the parent of every candidate text node under `root`.
  function watch(root) {
    if (!io) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (accept(root) && !watched.has(root.parentElement)) { watched.add(root.parentElement); io.observe(root.parentElement); }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      if (p && !watched.has(p) && accept(n)) { watched.add(p); io.observe(p); }
    }
  }

  /* ------------------------------ annotating ---------------------------- */

  let pending = [];   // text nodes waiting to be sent
  let flushing = false;
  let failures = 0;     // consecutive failed annotate calls (for retry backoff)

  function queue(el) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === Node.TEXT_NODE && accept(c)) pending.push(c);
    }
    flush();
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (on && pending.length) {
        const batch = [];
        let size = 0;
        while (pending.length && (size < MAX_BATCH_CHARS || !batch.length)) {
          const n = pending.shift();
          if (!n.isConnected || !accept(n)) continue;
          batch.push({ node: n, text: n.data });
          size += n.data.length;
        }
        if (!batch.length) break;
        const res = await send({ type: "furiganaAnnotate", texts: batch.map((b) => b.text) });
        if (!res || !res.ok) {
          if (res && res.reason === "no-dict") { stop(); break; }
          // Anything else (tokenizer failed to load, worker restarting): put
          // the batch back and try again shortly, up to a few times.
          pending.unshift(...batch.map((b) => b.node));
          if (failures++ < 4) setTimeout(flush, 1000 * failures);
          break;
        }
        failures = 0;
        if (!on) break;
        batch.forEach((b, i) => apply(b.node, b.text, res.results[i]));
      }
    } finally {
      flushing = false;
    }
  }

  function apply(node, text, spans) {
    // The page may have changed the text while we were waiting.
    if (!spans || !spans.length || !node.isConnected || node.data !== text) return;
    const frag = document.createDocumentFragment();
    const nodes = [];
    const addText = (t) => { if (!t) return; const tn = document.createTextNode(t); ours.add(tn); nodes.push(tn); frag.appendChild(tn); };
    let pos = 0;
    for (const sp of spans) {
      addText(text.slice(pos, sp.s));
      for (const seg of sp.segs) {
        if (!seg.r) { addText(seg.t); continue; }
        const ruby = document.createElement("ruby");
        ruby.className = "kotoba-furi";
        ruby.appendChild(document.createTextNode(seg.t));
        const rt = document.createElement("rt");
        rt.textContent = seg.r;
        ruby.appendChild(rt);
        ours.add(ruby);
        nodes.push(ruby);
        frag.appendChild(ruby);
      }
      pos = sp.e;
    }
    addText(text.slice(pos));
    node.replaceWith(frag);
    const g = { orig: node, nodes };
    groups.add(g);
    groupOf.set(node, g);
    // The page's own code may still hold `node`: put it back the moment it's
    // used (see furigana-guard.js) or its text is changed.
    if (!node.__kotobaFuriListening) {
      node.__kotobaFuriListening = true;
      node.addEventListener(RESTORE_EVT, onRestoreEvent);
    }
    origObserver.observe(node, { characterData: true });
  }

  /* --------------------------- giving nodes back ------------------------ */

  const RESTORE_EVT = "kotoba-furi-restore";

  // Put the original text node back where our nodes are, and drop ours.
  function restore(g) {
    if (!groups.has(g)) return;
    groups.delete(g);
    groupOf.delete(g.orig);
    const anchor = g.nodes.find((n) => n.isConnected);
    if (anchor && !g.orig.isConnected) anchor.parentNode.insertBefore(g.orig, anchor);
    for (const n of g.nodes) if (n.isConnected) n.remove();
  }

  // Fired by furigana-guard.js, synchronously, just before the page calls
  // removeChild/insertBefore/replaceChild with this node.
  function onRestoreEvent(e) {
    const g = groupOf.get(e.target);
    if (g) restore(g);
  }

  // The page changed the text of a node we'd swapped out (e.g. React updating
  // a counter): show the new text, then annotate it again.
  const origObserver = new MutationObserver((records) => {
    for (const r of records) {
      const g = groupOf.get(r.target);
      if (!g) continue;
      restore(g);
      if (on && r.target.isConnected && r.target.parentElement) queue(r.target.parentElement);
    }
  });

  /* ------------------------------ on / off ------------------------------ */

  function start() {
    if (on || !document.body) return;
    on = true;
    ensureStyles();
    watched = new WeakSet();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        watched.delete(e.target);
        queue(e.target);
      }
    }, { rootMargin: "600px 0px" });
    watch(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stop() {
    if (!on) return;
    on = false;
    observer.disconnect();
    if (io) { io.disconnect(); io = null; }
    pending = [];
    // Put the original text nodes back, so the page's own references to them
    // (frameworks keep them) still point at what's on screen.
    for (const g of [...groups]) restore(g);
    origObserver.disconnect();
  }

  let roots = new Set();
  let timer = null;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") { if (!ours.has(r.target)) roots.add(r.target); continue; }
      for (const n of r.addedNodes) if (!ours.has(n)) roots.add(n);
    }
    if (!roots.size) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...roots];
      roots = new Set();
      for (const n of list) if (n.isConnected) watch(n);
    }, 300);
  });

  // Frameworks that render on the server and then "hydrate" (React, Vue…)
  // expect the DOM to be untouched until they're done, so the first start
  // waits for the load event plus a short pause — but never more than ~2 s,
  // since heavy pages (ads, trackers) can take far longer to fire "load".
  let settled = false;
  const whenSettled = new Promise((resolve) => {
    const done = () => { if (!settled) { settled = true; resolve(); } };
    if (document.readyState === "complete") setTimeout(done, 700);
    else window.addEventListener("load", () => setTimeout(done, 700), { once: true });
    setTimeout(done, 2000);
  });

  async function sync() {
    if (!settled) await whenSettled;
    let s;
    try { s = await chrome.storage.local.get(["settings", "furiganaDict"]); }
    catch (_) { return; } // orphaned after an extension reload
    const want = !!(s.settings && s.settings.pageFurigana) && !!(s.furiganaDict && s.furiganaDict.state === "ready");
    if (want) start(); else stop();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.settings || changes.furiganaDict)) sync();
  });

  if (document.body) sync(); else document.addEventListener("DOMContentLoaded", sync, { once: true });
})();
