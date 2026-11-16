// furigana-dict.js — background side of "Furigana on pages" (furigana.js is
// the content-script side). Loaded into background.js with importScripts,
// after lib/kuromoji.js and core/furigana.js.
//
// - The tokenizer dictionary (kuromoji's IPAdic, ~18 MB gzipped) isn't in the
//   extension zip. It's downloaded once from this project's GitHub Release
//   (tag FURI_DICT_TAG) and kept, still gzipped, in its own IndexedDB
//   database. Status lives in chrome.storage.local "furiganaDict" so the
//   popup, Settings and every tab can follow progress via storage.onChanged.
// - The tokenizer is built lazily on the first lookup (~0.5 s) and lives as
//   long as the service worker does. It takes ~200 MB while built, which is
//   freed when the worker goes idle.

const FURI_DICT_TAG = "dict-ipadic-v1";
const FURI_DICT_BASE = `https://github.com/Rzkykhrllh/kotoba/releases/download/${FURI_DICT_TAG}/`;
// name -> gzipped size in bytes (for progress when Content-Length is missing).
const FURI_DICT_FILES = {
  "base.dat.gz": 3956825, "check.dat.gz": 3111633, "tid.dat.gz": 1605820, "tid_pos.dat.gz": 5916009,
  "tid_map.dat.gz": 1485576, "cc.dat.gz": 1692067, "unk.dat.gz": 10512, "unk_pos.dat.gz": 10540,
  "unk_map.dat.gz": 1190, "unk_char.dat.gz": 306, "unk_compat.dat.gz": 338, "unk_invoke.dat.gz": 1140,
};
const FURI_DICT_TOTAL = Object.values(FURI_DICT_FILES).reduce((a, b) => a + b, 0);
const FURI_DB = "kotobaDict";

// IPAdic's choice where most learners expect the other reading.
const FURI_READING_FIX = { "日本": "ニホン" };

let furiDownload = null;   // in-flight download promise
let furiTokenizer = null;  // Promise<Tokenizer>

/* ------------------------------ IndexedDB ------------------------------ */

function furiDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FURI_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function furiDbTx(mode, fn) {
  const db = await furiDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const out = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/* -------------------------------- status ------------------------------- */

async function furiSetStatus(status) {
  await chrome.storage.local.set({ furiganaDict: status });
  return status;
}

async function furiStatus() {
  const { furiganaDict } = await chrome.storage.local.get("furiganaDict");
  const st = furiganaDict || { state: "none" };
  // The worker was stopped mid-download (browser closed, extension reloaded).
  if (st.state === "downloading" && !furiDownload) return furiSetStatus({ state: "error", error: "Download was interrupted. Try again." });
  return st;
}

/* ------------------------------- download ------------------------------ */

function furiDownloadDict() {
  if (furiDownload) return furiDownload;
  furiDownload = (async () => {
    let done = 0, lastReport = 0;
    const report = async (force) => {
      const now = Date.now();
      // Each chrome.* call also resets the service worker's idle timer, which
      // is what keeps it alive for the whole download.
      if (!force && now - lastReport < 300) return;
      lastReport = now;
      await furiSetStatus({ state: "downloading", progress: Math.min(0.99, done / FURI_DICT_TOTAL), bytes: FURI_DICT_TOTAL });
    };
    try {
      await report(true);
      for (const name of Object.keys(FURI_DICT_FILES)) {
        const res = await fetch(FURI_DICT_BASE + name, { cache: "no-store" });
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        const reader = res.body.getReader();
        const chunks = [];
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          chunks.push(value);
          done += value.byteLength;
          await report(false);
        }
        const blob = new Blob(chunks);
        await furiDbTx("readwrite", (s) => s.put(blob, name));
      }
      furiTokenizer = null;
      return await furiSetStatus({ state: "ready", tag: FURI_DICT_TAG, bytes: done, installedAt: Date.now() });
    } catch (e) {
      return await furiSetStatus({ state: "error", error: `Download failed (${e.message || e}). Check your connection and try again.` });
    } finally {
      furiDownload = null;
    }
  })();
  return furiDownload;
}

async function furiRemoveDict() {
  furiTokenizer = null;
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(FURI_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  await furiSetStatus({ state: "none" });
}

/* ------------------------------ tokenizer ------------------------------ */

// Called by the patched loader in lib/kuromoji.js for each dictionary file.
self.kuromojiLoadFile = async (name) => {
  const blob = await furiDbTx("readonly", (s) => s.get(name));
  if (!blob) throw new Error(`dictionary file missing: ${name}`);
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
};

function furiGetTokenizer() {
  if (!furiTokenizer) {
    furiTokenizer = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: "kotoba-dict/" }).build((err, tk) => (err ? reject(err) : resolve(tk)));
    });
    furiTokenizer.catch(() => { furiTokenizer = null; });
  }
  return furiTokenizer;
}

// texts: string[] -> for each, [{ s, e, segs }] (see core/furigana.js).
async function furiAnnotate(texts) {
  const tk = await furiGetTokenizer();
  return texts.map((text) => {
    const tokens = tk.tokenize(text);
    for (const t of tokens) if (FURI_READING_FIX[t.surface_form]) t.reading = FURI_READING_FIX[t.surface_form];
    return furiFromTokens(tokens);
  });
}
