/*
 * furigana-guard.js — runs in the PAGE's world (manifest "world": "MAIN"),
 * at document_start. Companion to furigana.js.
 *
 * furigana.js swaps a text node for the same text with <ruby> inside. Page
 * frameworks (React, Vue…) keep references to their text nodes and later call
 * parent.removeChild(textNode) / parent.insertBefore(x, textNode); with the
 * node swapped out those calls would throw and can crash the app (the same
 * problem Google Translate has).
 *
 * This wraps those three DOM methods: if the node they're given isn't a child
 * of the parent (the call is about to throw), it first fires a
 * "kotoba-furi-restore" event at that node. furigana.js listens for it on
 * every node it swapped out and puts the original back synchronously, so the
 * framework's call then works. When furigana is off nothing listens, and the
 * call throws exactly as it would have anyway.
 */
(() => {
  if (window.__kotobaFuriGuard) return;
  window.__kotobaFuriGuard = true;
  const EVT = "kotoba-furi-restore";
  const P = Node.prototype;
  const wrap = (name, pick) => {
    const orig = P[name];
    if (typeof orig !== "function") return;
    P[name] = function (...args) {
      const n = pick(args);
      if (n && n.nodeType === 3 && n.parentNode !== this) {
        try { n.dispatchEvent(new Event(EVT)); } catch (_) {}
      }
      return orig.apply(this, args);
    };
  };
  wrap("removeChild", (a) => a[0]);
  wrap("insertBefore", (a) => a[1]);
  wrap("replaceChild", (a) => a[1]);
})();
