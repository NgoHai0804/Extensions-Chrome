(function ytdubSubtitleUtils() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});
  const cfg = core.DUBBING_CONFIG || {};

  core.createSubtitleUtils = function createSubtitleUtils(deps) {
    const { decodeHtml, getVideo, sleep, orderCaptionTracks, getTargetLang, log } = deps;
    const TIMEDTEXT_MIN_REQUEST_GAP_MS = Number.isFinite(Number(cfg.timedtextMinRequestGapMs))
      ? Math.max(100, Number(cfg.timedtextMinRequestGapMs))
      : 850;
    const TIMEDTEXT_429_BASE_COOLDOWN_MS = Number.isFinite(Number(cfg.timedtext429BaseCooldownMs))
      ? Math.max(300, Number(cfg.timedtext429BaseCooldownMs))
      : 2800;
    const TIMEDTEXT_429_MAX_COOLDOWN_MS = Number.isFinite(Number(cfg.timedtext429MaxCooldownMs))
      ? Math.max(TIMEDTEXT_429_BASE_COOLDOWN_MS, Number(cfg.timedtext429MaxCooldownMs))
      : 22000;
    let timedtextLastRequestAt = 0;
    let timedtextCooldownUntil = 0;
    /** Tránh race: nhiều coroutine cùng chờ rồi fetch một lúc (firstSuccess song song). */
    let timedtextFetchQueue = Promise.resolve();
    /** Cùng một timedtext (bỏ fmt) — dùng chung một Promise, không bắn trùng request. */
    const timedtextInflight = new Map();

    function timedtextDedupeKey(href) {
      try {
        const u = new URL(href, location.origin);
        const keySet = new Set();
        u.searchParams.forEach((_, k) => keySet.add(k));
        const keys = [...keySet].sort();
        const sp = new URLSearchParams();
        for (let i = 0; i < keys.length; i += 1) {
          const k = keys[i];
          if (/^fmt$/i.test(k)) continue;
          const vals = u.searchParams.getAll(k);
          for (let j = 0; j < vals.length; j += 1) sp.append(k, vals[j]);
        }
        const q = sp.toString();
        return q ? `${u.origin}${u.pathname}?${q}` : `${u.origin}${u.pathname}`;
      } catch {
        return href;
      }
    }

    function enqueueTimedtextFetch(fn) {
      const run = timedtextFetchQueue.then(() => fn());
      timedtextFetchQueue = run.catch(() => {});
      return run;
    }

    async function waitTimedtextRequestWindow() {
      const now = Date.now();
      const waitCooldown = Math.max(0, timedtextCooldownUntil - now);
      const waitGap = Math.max(0, TIMEDTEXT_MIN_REQUEST_GAP_MS - (now - timedtextLastRequestAt));
      const waitMs = Math.max(waitCooldown, waitGap);
      if (waitMs > 0) await sleep(waitMs);
      timedtextLastRequestAt = Date.now();
    }

    function pushTimedtextCooldown(level) {
      const n = Math.max(0, Number(level) || 0);
      const cooldown = Math.min(
        TIMEDTEXT_429_MAX_COOLDOWN_MS,
        TIMEDTEXT_429_BASE_COOLDOWN_MS * Math.pow(2, Math.min(n, 3))
      );
      timedtextCooldownUntil = Math.max(timedtextCooldownUntil, Date.now() + cooldown);
    }

    function parseJson3(data) {
      const events = Array.isArray(data?.events) ? data.events : [];
      const cues = [];
      for (let i = 0; i < events.length; i += 1) {
        const ev = events[i];
        if (typeof ev?.tStartMs !== "number") continue;
        let text = "";
        if (Array.isArray(ev.segs)) {
          for (let j = 0; j < ev.segs.length; j += 1) {
            const s = ev.segs[j];
            if (s && typeof s.utf8 === "string") text += s.utf8;
          }
        } else if (typeof ev.utf8 === "string") {
          text = ev.utf8;
        }
        text = String(text || "")
          .replace(/\n+/g, " ")
          .trim();
        if (!text) continue;
        const start = ev.tStartMs / 1000;
        const end = start + (typeof ev.dDurationMs === "number" ? ev.dDurationMs / 1000 : 2.5);
        cues.push({ start, end, text: decodeHtml(text) });
      }
      return cues.filter((c) => c.text && c.end > c.start);
    }

    function timedtextUrlWithFmt(baseUrl, fmt) {
      const u = String(baseUrl);
      const q = u.indexOf("?");
      if (q < 0) return `${u}?fmt=${encodeURIComponent(fmt)}`;
      const path = u.slice(0, q);
      const query = u.slice(q + 1);
      const parts = query.split("&").filter((kv) => kv && !/^fmt=/i.test(kv));
      const tail = parts.length ? `${parts.join("&")}&fmt=${encodeURIComponent(fmt)}` : `fmt=${encodeURIComponent(fmt)}`;
      return `${path}?${tail}`;
    }

    function timedtextUrlWithParam(baseUrl, key, value) {
      const raw = String(baseUrl || "");
      if (!raw || !key) return raw;
      try {
        const u = new URL(raw, location.origin);
        if (value == null || value === "") u.searchParams.delete(key);
        else u.searchParams.set(key, String(value));
        return u.toString();
      } catch {
        const q = raw.indexOf("?");
        const encK = encodeURIComponent(key);
        const encV = encodeURIComponent(String(value || ""));
        if (q < 0) return `${raw}?${encK}=${encV}`;
        const path = raw.slice(0, q);
        const pairs = raw
          .slice(q + 1)
          .split("&")
          .filter((kv) => kv && !kv.startsWith(`${encK}=`) && !kv.startsWith(`${key}=`));
        pairs.push(`${encK}=${encV}`);
        return `${path}?${pairs.join("&")}`;
      }
    }

    function langBase(code) {
      let s = String(code || "").trim().toLowerCase();
      if (!s) return "";
      if (s.startsWith("a.")) s = s.slice(2);
      const i = s.indexOf("-");
      if (i >= 0) s = s.slice(0, i);
      return s;
    }

    function vttPartToSec(p) {
      const bits = String(p || "")
        .trim()
        .split(":")
        .map((x) => x.replace(",", "."));
      if (bits.length === 3) return Number(bits[0]) * 3600 + Number(bits[1]) * 60 + parseFloat(bits[2]);
      if (bits.length === 2) return Number(bits[0]) * 60 + parseFloat(bits[1]);
      return parseFloat(p) || 0;
    }

    function parseWebVtt(raw) {
      const text = String(raw || "").replace(/^\uFEFF/, "");
      if (!/^WEBVTT/i.test(text)) return [];
      const cues = [];
      for (const block of text.split(/\r?\n\r?\n/)) {
        const lines = block.split(/\r?\n/).filter((l) => l.trim());
        if (!lines.length) continue;
        let li = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
        if (li >= lines.length) continue;
        const tm = lines[li].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
        if (!tm) continue;
        const start = vttPartToSec(tm[1]);
        const end = vttPartToSec(tm[2]);
        const rest = lines
          .slice(li + 1)
          .join(" ")
          .replace(/<[^>]+>/g, " ")
          .trim();
        const cueText = decodeHtml(rest);
        if (cueText && end > start) cues.push({ start, end, text: cueText });
      }
      return cues;
    }

    function parseTimedtextXml(raw) {
      const trimmed = String(raw || "").trim();
      if (!trimmed.includes("<")) return [];
      const low = trimmed.slice(0, 200).toLowerCase();
      if (low.includes("<!doctype html") || low.includes("<html")) return [];
      const doc = new DOMParser().parseFromString(trimmed, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) return [];
      const cues = [];
      const textEls = doc.getElementsByTagName("text");
      for (let i = 0; i < textEls.length; i += 1) {
        const el = textEls[i];
        const start = Number(el.getAttribute("start") || 0);
        const dur = Number(el.getAttribute("dur") || 0);
        const end = start + (dur > 0 ? dur : 2);
        const text = decodeHtml(String(el.textContent || "").replace(/\n+/g, " ").trim());
        if (text) cues.push({ start, end, text });
      }
      if (cues.length) return cues.filter((c) => c.end > c.start);
      const ps = doc.getElementsByTagName("p");
      for (let i = 0; i < ps.length; i += 1) {
        const el = ps[i];
        const tMs = Number(el.getAttribute("t") || 0);
        const dMs = Number(el.getAttribute("d") || 0);
        const start = tMs / 1000;
        const end = dMs > 0 ? start + dMs / 1000 : start + 2;
        const text = decodeHtml(String(el.textContent || "").replace(/\n+/g, " ").trim());
        if (text) cues.push({ start, end, text });
      }
      return cues.filter((c) => c.text && c.end > c.start);
    }

    function parseTimedtextBody(raw, fmtHint) {
      let trimmed = String(raw || "").replace(/^\uFEFF/, "").trim();
      if (!trimmed) return [];
      if (/^WEBVTT/im.test(trimmed)) {
        const v = parseWebVtt(trimmed);
        if (v.length) return v;
      }
      const jsonStart = trimmed.search(/[\[{]/);
      if (jsonStart >= 0 && jsonStart < 40) trimmed = trimmed.slice(jsonStart);
      const first = trimmed[0];
      if (first === "{" || first === "[") {
        try {
          const j = parseJson3(JSON.parse(trimmed));
          if (j.length) return j;
        } catch {
          /* continue */
        }
      }
      if (trimmed.includes('"events"') && trimmed.includes("tStartMs")) {
        try {
          const j = parseJson3(JSON.parse(trimmed));
          if (j.length) return j;
        } catch {
          /* continue */
        }
      }
      const xml = parseTimedtextXml(trimmed);
      if (xml.length) return xml;
      if (fmtHint === "vtt" || trimmed.includes("-->")) {
        const v = parseWebVtt(trimmed.startsWith("WEBVTT") ? trimmed : `WEBVTT\n\n${trimmed}`);
        if (v.length) return v;
      }
      return [];
    }

    async function fetchTimedtextCues(trackBaseUrl) {
      const abs =
        trackBaseUrl.startsWith("http://") || trackBaseUrl.startsWith("https://")
          ? trackBaseUrl
          : new URL(trackBaseUrl, location.origin).href;
      const dedupeKey = timedtextDedupeKey(abs);
      const inflight = timedtextInflight.get(dedupeKey);
      if (inflight) return inflight;

      const promise = enqueueTimedtextFetch(() => fetchTimedtextCuesSerialized(abs));
      timedtextInflight.set(dedupeKey, promise);
      promise.finally(() => {
        timedtextInflight.delete(dedupeKey);
      });
      return promise;
    }

    async function fetchTimedtextCuesSerialized(abs) {
      const urls = [];
      const seenU = new Set();
      function pushUrl(u) {
        if (!u || seenU.has(u)) return;
        seenU.add(u);
        urls.push(u);
      }
      pushUrl(abs);
      for (const fmt of ["json3", "srv3", "srv1", "vtt"]) pushUrl(timedtextUrlWithFmt(abs, fmt));

      /** Không gửi cookie — baseUrl từ player thường đã ký; tránh kết hợp cookie + context extension bị nghi bot. */
      const fetchOpts = { credentials: "omit" };

      let lastErr = null;
      for (let u = 0; u < urls.length; u += 1) {
        const url = urls[u];
        for (let att = 0; att < 3; att += 1) {
          try {
            if (att) await sleep(450 + 350 * att);
            await waitTimedtextRequestWindow();
            const res = await fetch(url, fetchOpts);
            if (!res.ok) {
              if (res.status === 429) pushTimedtextCooldown(att + u + 1);
              throw new Error(String(res.status));
            }
            const ct = (res.headers.get("content-type") || "").toLowerCase();
            if (ct.includes("image/") || ct.includes("video/") || ct.includes("font/")) throw new Error("wrong_mime");
            const body = await res.text();
            if (body.length > 0 && body.length < 80 && !/[\[{<W]/.test(body.slice(0, 5))) continue;
            const cues = parseTimedtextBody(body, "");
            if (cues.length) return cues;
          } catch (e) {
            lastErr = e;
          }
        }
      }
      if (lastErr) log("timedtext fail (đã thử URL gốc + fmt)", String(lastErr?.message || lastErr));
      return [];
    }

    function cuesFromOneTextTrack(track) {
      const cues = track?.cues;
      if (!cues?.length) return [];
      const out = [];
      for (let j = 0; j < cues.length; j += 1) {
        const c = cues[j];
        const text = String(c.text || "").replace(/\n+/g, " ").trim();
        if (!text) continue;
        out.push({ start: Number(c.startTime || 0), end: Number(c.endTime || 0), text });
      }
      return out.filter((c) => c.end > c.start);
    }

    function cuesFromTextTracks() {
      const video = getVideo();
      if (!video?.textTracks?.length) return [];
      let best = [];
      for (let i = 0; i < video.textTracks.length; i += 1) {
        const tr = video.textTracks[i];
        try {
          if (tr.mode === "disabled") tr.mode = "hidden";
        } catch {
          /* ignore */
        }
        const ok = cuesFromOneTextTrack(tr);
        if (ok.length > best.length) best = ok;
      }
      return best;
    }

    function clickYouTubeCcButton() {
      const btn = document.querySelector("button.ytp-subtitles-button");
      if (btn && btn.getAttribute("aria-pressed") === "false") {
        btn.click();
        log("Đã bật CC");
        return true;
      }
      return false;
    }

    async function loadCuesFromTextTracksOnly(maxMs) {
      clickYouTubeCcButton();
      const video = getVideo();
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        if (video?.textTracks?.length) {
          for (let i = 0; i < video.textTracks.length; i += 1) {
            const tr = video.textTracks[i];
            try {
              for (let j = 0; j < video.textTracks.length; j += 1) {
                video.textTracks[j].mode = j === i ? "showing" : "disabled";
              }
            } catch {
              /* ignore */
            }
            await sleep(180);
            const part = cuesFromOneTextTrack(tr);
            if (part.length >= 1) return part;
          }
        }
        const merged = cuesFromTextTracks();
        if (merged.length >= 1) return merged;
        await sleep(280);
      }
      return [];
    }

    async function loadCuesFromCaptionTracks(tracks) {
      if (!tracks?.length) return null;
      const seen = new Set();
      const sequence = [];
      const rawList = tracks.filter((t) => t?.baseUrl);
      for (let i = 0; i < rawList.length; i += 1) {
        const t = rawList[i];
        if (seen.has(t.baseUrl)) continue;
        seen.add(t.baseUrl);
        sequence.push(t);
      }
      const preferred = orderCaptionTracks(tracks);
      for (let i = 0; i < preferred.length; i += 1) {
        const t = preferred[i];
        if (!t?.baseUrl || seen.has(t.baseUrl)) continue;
        seen.add(t.baseUrl);
        sequence.push(t);
      }
      for (let i = 0; i < sequence.length; i += 1) {
        const cap = sequence[i];
        const target = String(getTargetLang?.() || "vi");
        const targetBase = langBase(target);
        const capBase = langBase(cap.languageCode || "");
        const candidates = [];
        const seenUrl = new Set();
        function pushCandidate(url) {
          if (!url || seenUrl.has(url)) return;
          seenUrl.add(url);
          candidates.push(url);
        }

        // Ưu tiên auto-translate tại nguồn timedtext theo targetLang của user.
        if (targetBase && capBase && capBase !== targetBase) {
          pushCandidate(timedtextUrlWithParam(cap.baseUrl, "tlang", target));
          pushCandidate(timedtextUrlWithParam(cap.baseUrl, "tlang", targetBase));
        }
        pushCandidate(cap.baseUrl);

        let cues = [];
        for (let u = 0; u < candidates.length; u += 1) {
          cues = await fetchTimedtextCues(candidates[u]);
          if (cues.length) break;
        }
        if (cues.length) return { cues, lang: cap.languageCode || cap.name?.simpleText || "" };
      }
      return null;
    }

    return {
      fetchTimedtextCues,
      loadCuesFromTextTracksOnly,
      loadCuesFromCaptionTracks
    };
  };
})();
