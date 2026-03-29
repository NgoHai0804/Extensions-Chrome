/** Chuẩn hóa cue, tách câu, chỉnh start/end cho đồng bộ đọc. */
(function ytdubSubtitleTimeline() {
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

  const INTER_WORD_GAP_MERGE_MAX = 0.5;
  /** Khe nhỏ giữa hai cue liền nhau: gom biên để đọc không bị ngắt (giây). */
  const GAP_SNAP_MAX = 0.14;
  /** Cho phép chồng thời gian nhỏ khi gộp cue; vượt ngưỡng thì không gộp (giây). */
  const SOURCE_OVERLAP_TOLERANCE = 0.12;
  const MIN_CUE_DURATION = 0.04;

  function sanitizeSubtitleText(raw) {
    let s = String(raw || "");
    s = s.replace(/\([^)]*\)/g, " ");
    s = s.replace(/（[^）]*）/g, " ");
    s = s.replace(/\[(?:[^\]\r\n]{1,80})\]/g, " ");
    s = s.replace(/(?:^|\s)(?:>>|<<|>|<)+(?:\s|$)/g, " ");
    s = s.replace(/(?:^|\s)(?:\.{3,}|…+)(?=\s|$)/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  /** Nếu khe giữa hai cue quá nhỏ: kéo start cue sau sát end cue trước. */
  function snapMicroGapsBetweenCues(cues, maxGapSec) {
    const lim = Number(maxGapSec);
    const cap = Number.isFinite(lim) && lim > 0 ? lim : GAP_SNAP_MAX;
    if (!Array.isArray(cues) || cues.length < 2) return cues;
    for (let i = 1; i < cues.length; i += 1) {
      const prev = cues[i - 1];
      const cur = cues[i];
      const pe = Number(prev.end);
      const ns = Number(cur.start);
      if (!Number.isFinite(pe) || !Number.isFinite(ns)) continue;
      const gap = ns - pe;
      if (gap > 0 && gap <= cap) {
        cur.start = pe;
      }
    }
    return cues;
  }

  function sortCuesByTime(arr) {
    return [...arr]
      .filter((c) => c && String(c.text || "").trim())
      .sort((a, b) => {
        const da = Number(a.start) || 0;
        const db = Number(b.start) || 0;
        if (da !== db) return da - db;
        return (Number(a.end) || 0) - (Number(b.end) || 0);
      });
  }

  /** Sắp theo start; cắt end không vượt start cue sau; không lùi start; tối thiểu độ dài. */
  function normalizeSourceCueWindows(cues, minDurSec) {
    const sorted = sortCuesByTime(cues);
    const out = [];
    const minDur = Number(minDurSec);
    const eps = Number.isFinite(minDur) && minDur > 0 ? minDur : MIN_CUE_DURATION;
    let cursor = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      let s = Number(cur.start);
      let e = Number(cur.end);
      if (!Number.isFinite(s)) s = cursor;
      if (!Number.isFinite(e)) e = s;
      if (e < s) e = s;
      const nextS = Number(next?.start);
      if (Number.isFinite(nextS) && nextS > s) e = Math.min(e, nextS);
      if (s < cursor) s = cursor;
      if (e < s + eps) e = s + eps;
      cursor = e;
      out.push({ start: s, end: e, text: String(cur.text || "").trim() });
    }
    return out;
  }

  function trimSpan(full, a, b) {
    let u = a;
    let v = b;
    while (u < v && /\s/.test(full[u])) u += 1;
    while (v > u && /\s/.test(full[v - 1])) v -= 1;
    return { u, v };
  }

  function endsWithSentencePunct(raw) {
    const s = String(raw || "").trim();
    if (!s) return false;
    const last = s[s.length - 1];
    if (".!?。！？".includes(last)) return true;
    if (last === "…") return true;
    if (s.length >= 3 && s.endsWith("...")) return true;
    return false;
  }

  function mergeAdjacentRawCuesForNoPunct(cues, maxGapSec) {
    const lim = Number(maxGapSec);
    const cap = Number.isFinite(lim) && lim > 0 ? lim : INTER_WORD_GAP_MERGE_MAX;
    const sorted = normalizeSourceCueWindows(cues, MIN_CUE_DURATION);
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      let cs = Number(sorted[i].start);
      let ce = Number(sorted[i].end);
      if (!Number.isFinite(cs)) cs = 0;
      if (!Number.isFinite(ce)) ce = cs;
      if (ce < cs) ce = cs;
      let text = String(sorted[i].text || "").trim();

      let j = i;
      while (j + 1 < sorted.length) {
        if (endsWithSentencePunct(text)) break;
        const nxt = sorted[j + 1];
        let ns = Number(nxt.start);
        let ne = Number(nxt.end);
        if (!Number.isFinite(ns)) ns = ce;
        if (!Number.isFinite(ne)) ne = ns;
        if (ne < ns) ne = ns;
        const gap = ns - ce;
        const g = Number.isFinite(gap) ? gap : cap + 1;
        if (g >= cap || g < -SOURCE_OVERLAP_TOLERANCE) break;
        text = `${text} ${String(nxt.text || "").trim()}`.replace(/\s+/g, " ").trim();
        cs = Math.min(cs, ns);
        ce = Math.max(ce, ne);
        j += 1;
      }
      out.push({ start: cs, end: ce, text });
      i = j + 1;
    }
    return out;
  }

  function buildWordTimelineFromCues(cues) {
    const sorted = normalizeSourceCueWindows(cues, MIN_CUE_DURATION);
    const tokens = [];
    for (const c of sorted) {
      const piece = sanitizeSubtitleText(c.text);
      const words = piece.split(/\s+/).filter(Boolean);
      if (!words.length) continue;

      const t0 = Number.isFinite(Number(c.start)) ? Number(c.start) : 0;
      let t1 = Number.isFinite(Number(c.end)) ? Number(c.end) : t0;
      if (t1 < t0) t1 = t0;
      const dur = Math.max(0.001, t1 - t0);
      const n = words.length;

      for (let i = 0; i < n; i += 1) {
        tokens.push({
          text: words[i],
          t0: t0 + (i / n) * dur,
          t1: t0 + ((i + 1) / n) * dur
        });
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
    if (i0 < 0) return null;
    return { tStart: tokens[i0].t0, tEnd: tokens[i1].t1 };
  }

  function spansByPunctuation(full) {
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
        spans.push({ a, b: n, checkWordGap: true });
        break;
      }
      let b = endPos;
      while (b < n && "\"'」』)]".includes(full[b])) b += 1;
      spans.push({ a, b, checkWordGap: false });
      a = b;
    }
    return spans;
  }

  function splitSpanByInterWordGap(full, tokens, offsets, spanA, spanB, maxGapSec) {
    const cap = Number(maxGapSec);
    const lim = Number.isFinite(cap) && cap > 0 ? cap : INTER_WORD_GAP_MERGE_MAX;
    const idxs = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const o = offsets[i];
      const e = o + tokens[i].text.length;
      if (e > spanA && o < spanB) idxs.push(i);
    }
    if (idxs.length <= 1) return [{ a: spanA, b: spanB }];

    const cuts = [spanA];
    for (let k = 1; k < idxs.length; k += 1) {
      const g = Number(tokens[idxs[k]].t0) - Number(tokens[idxs[k - 1]].t1);
      const gap = Number.isFinite(g) ? g : 0;
      if (gap >= lim) cuts.push(offsets[idxs[k]]);
    }
    cuts.push(spanB);
    const out = [];
    for (let c = 0; c < cuts.length - 1; c += 1) {
      out.push({ a: cuts[c], b: cuts[c + 1] });
    }
    return out.length ? out : [{ a: spanA, b: spanB }];
  }

  function splitSubtitleCuesBySentences(cues) {
    if (!Array.isArray(cues) || !cues.length) return [];
    const mergedRaw = mergeAdjacentRawCuesForNoPunct(cues, INTER_WORD_GAP_MERGE_MAX);
    const { full, tokens, offsets } = buildWordTimelineFromCues(mergedRaw);
    if (!full || !tokens.length) return [];

    const EPS = 0.04;
    const raw = [];

    function pushCharSpan(u, v) {
      const { u: uu, v: vv } = trimSpan(full, u, v);
      if (vv <= uu) return;
      const text = sanitizeSubtitleText(full.slice(uu, vv));
      if (!text) return;
      const tr = timeRangeForTextSpan(tokens, offsets, uu, vv);
      if (!tr) return;
      let start = Number(tr.tStart);
      let end = Number(tr.tEnd);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start;
      if (end < start) {
        const t = start;
        start = end;
        end = t;
      }
      if (end < start + EPS) end = start + EPS;
      raw.push({ start, end, text });
    }

    for (const { a, b, checkWordGap } of spansByPunctuation(full)) {
      if (!checkWordGap) {
        pushCharSpan(a, b);
        continue;
      }
      for (const { a: sa, b: sb } of splitSpanByInterWordGap(
        full,
        tokens,
        offsets,
        a,
        b,
        INTER_WORD_GAP_MERGE_MAX
      )) {
        pushCharSpan(sa, sb);
      }
    }

    if (!raw.length) return [];

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

    snapMicroGapsBetweenCues(out, GAP_SNAP_MAX);
    for (let i = 0; i < out.length - 1; i += 1) {
      const nextS = Number(out[i + 1].start);
      if (Number.isFinite(nextS)) {
        out[i].end = Math.min(Number(out[i].end), nextS);
      }
    }
    for (let i = 0; i < out.length; i += 1) {
      const s = Number(out[i].start);
      let e = Number(out[i].end);
      if (!Number.isFinite(s)) continue;
      if (!Number.isFinite(e) || e <= s) e = s + EPS;
      out[i].end = e;
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
    snapMicroGapsBetweenCues(arr, GAP_SNAP_MAX);
    for (let i = 0; i < arr.length - 1; i += 1) {
      const nextS = Number(arr[i + 1].start);
      if (Number.isFinite(nextS)) {
        arr[i].end = Math.min(Number(arr[i].end), nextS);
      }
    }
    for (let i = 0; i < arr.length; i += 1) {
      const c = arr[i];
      let s = Number(c.start);
      let e = Number(c.end);
      if (!Number.isFinite(s)) s = 0;
      if (!Number.isFinite(e) || e <= s) e = s + EPS;
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
