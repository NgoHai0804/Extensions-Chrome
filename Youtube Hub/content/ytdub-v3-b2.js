/** B2 — tách SUB theo dấu câu; thời gian trong mỗi đoạn chia đều theo số từ × duration, rồi gộp câu. */
(function ytdubV3B2() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const {
    state,
    STORAGE_KEY,
    mergeExtensionSettings,
    MSG_TRANSLATE,
    translatePromises,
    PREFETCH_AHEAD,
    log,
    extOk
  } = V;

  function trimSpan(full, a, b) {
    let u = a;
    let v = b;
    while (u < v && /\s/.test(full[u])) u += 1;
    while (v > u && /\s/.test(full[v - 1])) v -= 1;
    return { u, v };
  }

  /**
   * Lọc noise thường gặp trong phụ đề auto để tránh TTS đọc thừa.
   * - Ký hiệu hướng thoại: >>, <<, >, <
   * - Nhãn trong ngoặc vuông: [Nhạc], [Âm nhạc], [Music], ...
   * - Dấu "..." đứng riêng như một token
   */
  function sanitizeSubtitleText(raw) {
    let s = String(raw || "");
    s = s.replace(/\[(?:[^\]\r\n]{1,80})\]/g, " ");
    s = s.replace(/(?:^|\s)(?:>>|<<|>|<)+(?:\s|$)/g, " ");
    s = s.replace(/(?:^|\s)(?:\.{3,}|…+)(?=\s|$)/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  /**
   * Trong mỗi đoạn SUB: duration = end − start, chia đều cho từng từ (n từ → mỗi từ một khoảng duration/n).
   * Ghép toàn bộ từ theo thứ tự thành một chuỗi (cách nhau bằng dấu cách) để tách câu.
   */
  function buildWordTimelineFromCues(cues) {
    const sorted = [...cues]
      .filter((c) => c && String(c.text || "").trim())
      .sort((a, b) => {
        const da = Number(a.start) || 0;
        const db = Number(b.start) || 0;
        if (da !== db) return da - db;
        return (Number(a.end) || 0) - (Number(b.end) || 0);
      });

    /** @type {{ text: string, t0: number, t1: number }[]} */
    const tokens = [];

    for (const c of sorted) {
      const piece = sanitizeSubtitleText(c.text);
      const words = piece.split(/\s+/).filter(Boolean);
      if (!words.length) continue;

      const cs = Number(c.start);
      const ce = Number(c.end);
      const t0 = Number.isFinite(cs) ? cs : 0;
      const t1 = Number.isFinite(ce) ? ce : t0;
      const dur = Math.max(0.001, t1 - t0);
      const n = words.length;

      for (let i = 0; i < n; i += 1) {
        const w0 = t0 + (i / n) * dur;
        const w1 = t0 + ((i + 1) / n) * dur;
        tokens.push({ text: words[i], t0: w0, t1: w1 });
      }
    }

    const full = tokens.map((t) => t.text).join(" ");
    const offsets = [];
    let pos = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      if (i) pos += 1;
      offsets[i] = pos;
      pos += tokens[i].text.length;
    }

    return { full, tokens, offsets };
  }

  /** Span ký tự [u,v) trên chuỗi ghép → thời điểm bắt đầu từ đầu tiên / kết thúc từ cuối cùng giao cắt. */
  function timeRangeForTextSpan(tokens, offsets, u, v) {
    if (!tokens.length || v <= u) return null;
    let i0 = -1;
    let i1 = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      const o = offsets[i];
      const e = o + tokens[i].text.length;
      if (e > u && o < v) {
        if (i0 < 0) i0 = i;
        i1 = i;
      }
    }
    if (i0 < 0 || i1 < 0) return null;
    return { tStart: tokens[i0].t0, tEnd: tokens[i1].t1 };
  }

  /** Tách theo . ? ! … và ... (ASCII); phần cuối không có dấu vẫn thành một câu. */
  function extractSentenceSpans(full) {
    const spans = [];
    const n = full.length;
    let a = 0;

    function punctEndAt(j) {
      if (j >= n) return -1;
      const c = full[j];
      if (c === "…") return j + 1;
      if (c === "." && full.slice(j, j + 3) === "...") return j + 3;
      if (".!?。！？".includes(c)) return j + 1;
      return -1;
    }

    while (a < n) {
      while (a < n && /\s/.test(full[a])) a += 1;
      if (a >= n) break;

      let j = a;
      let endPos = -1;
      while (j < n) {
        const pe = punctEndAt(j);
        if (pe > j) {
          endPos = pe;
          break;
        }
        j += 1;
      }

      if (endPos < 0) {
        spans.push({ a, b: n });
        break;
      }

      let b = endPos;
      while (b < n && "\"'」』)]".includes(full[b])) b += 1;
      spans.push({ a, b });
      a = b;
    }

    return spans;
  }

  /**
   * Ghép từ (chia duration theo từ) → tách câu theo dấu câu → start/end từ các từ giao cắt câu.
   */
  function splitSubtitleCuesBySentences(cues) {
    if (!Array.isArray(cues) || !cues.length) return [];
    const { full, tokens, offsets } = buildWordTimelineFromCues(cues);
    if (!full || !tokens.length) return [];

    const spans = extractSentenceSpans(full);
    const EPS = 0.04;
    const raw = [];

    for (const { a, b } of spans) {
      const { u, v } = trimSpan(full, a, b);
      if (v <= u) continue;

      const text = sanitizeSubtitleText(full.slice(u, v));
      if (!text) continue;

      const tr = timeRangeForTextSpan(tokens, offsets, u, v);
      if (!tr) continue;

      let start = Number(tr.tStart);
      let end = Number(tr.tEnd);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start;
      if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      if (end < start + EPS) end = start + EPS;

      raw.push({ start, end, text });
    }

    if (!raw.length) return [];

    // Ưu tiên giữ start gốc để khớp môi; nếu overlap thì cắt end câu trước.
    const out = [];
    for (let i = 0; i < raw.length; i += 1) {
      const cur = raw[i];
      const prev = out.length ? out[out.length - 1] : null;

      let start = cur.start;
      let end = cur.end;

      if (prev && start < prev.end) {
        const prevStart = Number(prev.start) || 0;
        prev.end = Math.max(prevStart + EPS, start);
      }
      if (end < start + EPS) end = start + EPS;

      out.push({ start, end, text: cur.text });
    }
    return out;
  }

  async function translateLines(texts) {
    if (!extOk()) throw new Error("Extension không hợp lệ — F5");
    let fresh;
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      fresh = mergeExtensionSettings(r[STORAGE_KEY]);
    } catch {
      fresh = mergeExtensionSettings({});
    }
    state.settings = { ...state.settings, ...fresh };
    const targetLang = fresh.targetLang;
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: MSG_TRANSLATE,
          payload: {
            texts,
            sourceLang: fresh.sourceLang,
            targetLang
          }
        },
        (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (res?.ok && Array.isArray(res.lines)) resolve(res.lines);
          else reject(new Error(res?.error || "Dịch lỗi"));
        }
      );
    });
  }

  function translateLinesQueued(texts) {
    const run = () => translateLines(texts);
    const next = V.translateMutex.then(run, run);
    V.translateMutex = next.catch(() => {});
    return next;
  }

  function normLangBase(code) {
    if (code == null || typeof code !== "string") return "";
    let s = String(code).trim().toLowerCase();
    if (s.startsWith("a.")) s = s.slice(2);
    const i = s.indexOf("-");
    if (i >= 0) s = s.slice(0, i);
    return s || "";
  }

  function needsTranslation() {
    const tgt = normLangBase(state.settings?.targetLang);
    const trk = normLangBase(state.subtitleTrackLang);
    if (!tgt) return true;
    if (!trk) return true;
    return tgt !== trk;
  }

  function initCuesFromSubtitleRows(rows) {
    if (!needsTranslation()) {
      return rows.map((c) => ({
        start: c.start,
        end: c.end,
        src: c.text,
        txt: c.text
      }));
    }
    return rows.map((c) => ({
      start: c.start,
      end: c.end,
      src: c.text,
      txt: null
    }));
  }

  /**
   * Căn `end` mỗi cue tới `start` cue kế — khớp hành vi CC (dòng chuyển khi dòng sau bắt đầu).
   * Tránh timedtext/json3 kéo dài `end` → TTS tính khung quá dài, chậm hơn thực tế và lệch câu.
   */
  function normalizeCueTimeline(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return arr;
    arr.sort((a, b) => {
      const da = Number(a.start) || 0;
      const db = Number(b.start) || 0;
      if (da !== db) return da - db;
      return (Number(a.end) || 0) - (Number(b.end) || 0);
    });
    const EPS = 0.03;
    for (let i = 0; i < arr.length; i += 1) {
      const c = arr[i];
      let s = Number(c.start);
      if (!Number.isFinite(s)) s = 0;
      let e = Number(c.end);
      if (!Number.isFinite(e)) e = s + EPS;
      if (i + 1 < arr.length) {
        const nextS = Number(arr[i + 1].start);
        if (Number.isFinite(nextS)) e = Math.min(e, nextS);
      }
      if (e <= s) e = s + EPS;
      c.start = s;
      c.end = e;
    }
    return arr;
  }

  async function ensureCueTranslated(i) {
    const c = state.cues[i];
    if (!c || c.txt != null) return;
    if (!needsTranslation()) {
      c.txt = c.src;
      return;
    }
    if (translatePromises.has(i)) {
      await translatePromises.get(i);
      return;
    }
    const p = (async () => {
      try {
        const lines = await translateLinesQueued([c.src]);
        c.txt = String(lines[0] ?? c.src).trim() || c.src;
      } catch (e) {
        log("Dịch 1 dòng lỗi, giữ nguyên gốc:", i, e);
        c.txt = c.src;
      } finally {
        translatePromises.delete(i);
      }
    })();
    translatePromises.set(i, p);
    await p;
  }

  function prefetchCueWindow(centerIdx) {
    const n = state.cues.length;
    if (!n) return;
    const from = Math.max(0, centerIdx);
    const to = Math.min(n - 1, centerIdx + PREFETCH_AHEAD);
    for (let j = from; j <= to; j += 1) {
      void ensureCueTranslated(j);
    }
  }

  Object.assign(V, {
    splitSubtitleCuesBySentences,
    translateLines,
    translateLinesQueued,
    normLangBase,
    needsTranslation,
    initCuesFromSubtitleRows,
    normalizeCueTimeline,
    ensureCueTranslated,
    prefetchCueWindow
  });
})();
