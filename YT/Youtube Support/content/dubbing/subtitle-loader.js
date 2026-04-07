/** Tải phụ đề thô: YouTube, cache session, thư viện transcript. */
(function ytdubSubtitleLoader() {
  const V = window.__YTDUB_V3;
  if (!V) return;

  const {
    CORE,
    state,
    env,
    DUBBING_CONFIG,
    MSG_CACHED_TT,
    MSG_FETCH_YT_LIB,
    MSG_FETCH_TIMEDTEXT_BODY,
    chromeRuntimeOk,
    log
  } = V;
  const logPipeline = typeof CORE.logSubtitlePipelineStep === "function" ? CORE.logSubtitlePipelineStep.bind(CORE) : () => {};
  const NEWBIE_SUBTITLE_GUIDE =
    "Hướng dẫn cho người mới:\n" +
    "1) Vào https://www.youtube.com/account_playback, bật 'Always show captions' và 'Include auto-generated captions'.\n" +
    "2) Bật CC trên video YouTube (nút Phụ đề/CC).\n" +
    "3) Mở Cài đặt (biểu tượng bánh răng) → Phụ đề.\n" +
    "4) Chọn 'Tự động dịch' và chọn ngôn ngữ bạn muốn.\n" +
    "5) Chờ 2-3 giây để YouTube nạp track phụ đề.\n" +
    "6) Quay lại và bấm nút Dịch của extension.";
  /** Ngân sách thời gian lấy sub (theo config). */
  const B1_TOTAL_BUDGET_MS = Number.isFinite(Number(DUBBING_CONFIG?.subtitleLoadTimeoutMs))
    ? Math.max(1500, Number(DUBBING_CONFIG.subtitleLoadTimeoutMs))
    : 10000;
  const TIMEDTEXT_SAME_URL_RETRY_GAP_MS = Number.isFinite(Number(DUBBING_CONFIG?.timedtextSameUrlRetryGapMs))
    ? Math.max(1000, Number(DUBBING_CONFIG.timedtextSameUrlRetryGapMs))
    : 6000;
  const timedtextUrlSeenAt = new Map();

  /** Signed timedtext có `expire` — dùng lại sau khi hết hạn → trắng/403. */
  function timedtextSignedUrlLikelyStale(urlStr) {
    try {
      const u = new URL(String(urlStr || ""), "https://www.youtube.com");
      const ex = u.searchParams.get("expire");
      if (ex == null || ex === "") return false;
      const t = Number(ex);
      if (!Number.isFinite(t)) return false;
      return Date.now() / 1000 > t - 90;
    } catch {
      return false;
    }
  }

  function leftMs(deadline) {
    return Math.max(0, Number(deadline || 0) - Date.now());
  }

  /**
   * Song song nhiều cách lấy sub; khi một kết quả OK hoặc hết timeout / tất cả thất bại
   * thì `abort()` — không gọi thêm timedtext (fetch trong subtitle-utils) cho các coroutine còn lại.
   * @param {Array<(signal: AbortSignal) => Promise<{ cues: unknown[], lang?: string }|null>>} taskFns
   */
  async function firstSuccess(taskFns, timeoutMs) {
    if (!Array.isArray(taskFns) || !taskFns.length) return null;
    const ac = new AbortController();
    const { signal } = ac;
    return await new Promise((resolve) => {
      let settled = false;
      let remaining = taskFns.length;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ac.abort();
        } catch {
          /* ignore */
        }
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), Math.max(200, Number(timeoutMs) || 0));

      for (let i = 0; i < taskFns.length; i += 1) {
        const fn = taskFns[i];
        Promise.resolve()
          .then(() => fn(signal))
          .then((v) => {
            if (settled) return;
            if (v && v.cues?.length) {
              finish(v);
              return;
            }
            remaining -= 1;
            if (remaining <= 0 && !settled) finish(null);
          })
          .catch(() => {
            if (settled) return;
            remaining -= 1;
            if (remaining <= 0 && !settled) finish(null);
          });
      }
    });
  }

  function logSubtitleOk(method, videoId, cues, lang) {
    if (CORE.logSubtitleOk) {
      CORE.logSubtitleOk(log, method, videoId, cues, lang);
      const n = cues?.length || 0;
      if (n && typeof CORE.logSubtitlePipelineStep === "function") {
        CORE.logSubtitlePipelineStep("SUB_OK", method, "videoId=" + videoId, "cues=" + n);
      }
      return;
    }
    const n = cues.length;
    if (!n) return;
    log("SUB_OK | method=" + method, "| videoId=" + videoId, "| cues=" + n);
    if (typeof CORE.logSubtitlePipelineStep === "function") {
      CORE.logSubtitlePipelineStep("SUB_OK", method, "videoId=" + videoId, "cues=" + n);
    }
  }

  function returnIfCues(method, videoId, cues, lang) {
    if (!cues?.length) return null;
    logSubtitleOk(method, videoId, cues, lang || "");
    return { cues, lang: lang || "" };
  }

  /**
   * URL + HTTP status lần gần nhất bắt được từ tab (webRequest onCompleted), kể cả 429.
   * @returns {Promise<{ url: string, status: number | null }>}
   */
  const rtOk =
    typeof chromeRuntimeOk === "function" ? chromeRuntimeOk : () => Boolean(chrome?.runtime?.id);

  async function getCachedTimedtextUrl(videoId, msgTimeoutMs) {
    const empty = () => ({ url: "", status: null });
    if (!videoId) {
      logPipeline("cache timedtext | bỏ qua (không có videoId)");
      return empty();
    }
    if (!rtOk()) {
      logPipeline("cache timedtext | bỏ qua (!chrome.runtime — không gửi SW)");
      return empty();
    }
    const wait = Math.max(500, Math.min(4000, Number(msgTimeoutMs) || 1600));
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        logPipeline("cache timedtext | timeout chờ SW (" + wait + "ms) videoId=" + videoId);
        resolve(empty());
      }, wait);
      try {
        chrome.runtime.sendMessage({ type: MSG_CACHED_TT, videoId }, (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            logPipeline("cache timedtext | lastError:", chrome.runtime.lastError.message);
            resolve(empty());
            return;
          }
          if (!res?.ok) {
            logPipeline("cache timedtext | SW trả !ok videoId=" + videoId);
            resolve(empty());
            return;
          }
          const url = res.url ? String(res.url) : "";
          const st = res.status;
          const status = typeof st === "number" && Number.isFinite(st) ? st : null;
          if (url) {
            logPipeline(
              "cache timedtext | hit status=" + String(status ?? "—") + " len=" + url.length
            );
          } else {
            logPipeline("cache timedtext | chưa có URL (chờ webRequest /api/timedtext) videoId=" + videoId);
          }
          resolve({ url, status });
        });
      } catch {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(empty());
      }
    });
  }

  async function loadCuesFromYoutubeTranscriptLib(videoId) {
    if (!videoId) {
      logPipeline("youtube-transcript lib | bỏ qua (không có videoId)");
      return null;
    }
    if (!rtOk()) {
      logPipeline("youtube-transcript lib | bỏ qua (!chrome.runtime)");
      return null;
    }
    logPipeline("youtube-transcript lib | gửi MSG_FETCH_YT_LIB videoId=" + videoId);
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        logPipeline("youtube-transcript lib | timeout 16s");
        log("youtube-transcript: timeout");
        resolve(null);
      }, 16000);
      try {
        chrome.runtime.sendMessage(
          { type: MSG_FETCH_YT_LIB, payload: { videoId, lang: undefined } },
          (res) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              logPipeline("youtube-transcript lib | lastError:", chrome.runtime.lastError.message);
              log("youtube-transcript:", chrome.runtime.lastError.message);
              resolve(null);
              return;
            }
            if (res?.ok && Array.isArray(res.cues) && res.cues.length) {
              logPipeline(
                "youtube-transcript lib | OK cues=" + res.cues.length + " lang=" + String(res.lang || "")
              );
              logSubtitleOk("youtube-transcript (npm → service worker)", videoId, res.cues, String(res.lang || ""));
              resolve({ cues: res.cues, lang: String(res.lang || "") });
              return;
            }
            if (res?.error === "empty_transcript") {
              logPipeline("youtube-transcript lib | empty_transcript (fallback CC/timedtext)");
              log("B1 | youtube-transcript (service worker) rỗng — bình thường, sẽ dùng CC trên trang / timedtext");
            } else if (res?.error) {
              logPipeline("youtube-transcript lib | error:", String(res.error));
              log("youtube-transcript:", res.error);
            }
            resolve(null);
          }
        );
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        logPipeline("youtube-transcript lib | exception:", String(e?.message || e));
        log("youtube-transcript:", e);
        resolve(null);
      }
    });
  }

  async function loadTextTracksWithRetries(delaysMs, tag, videoIdForLog) {
    const delays = Array.isArray(delaysMs) && delaysMs.length ? delaysMs : [900];
    for (let i = 0; i < delays.length; i += 1) {
      const waitMs = Number(delays[i]) || 900;
      const cues = await loadCuesFromTextTracksOnly(waitMs);
      const out = returnIfCues(`${tag} (${i + 1}/${delays.length})`, videoIdForLog || "—", cues, "");
      if (out) return out;
    }
    return null;
  }

  function pickTrack(tracks, sourceLang, targetLang) {
    const target = String(targetLang || "vi").toLowerCase().split("-")[0];
    const manual = String(sourceLang || "auto").toLowerCase();
    const list = tracks.filter((x) => x?.baseUrl);
    if (!list.length) return null;
    if (manual !== "auto") {
      const pref = manual.split("-")[0];
      return (
        list.find((t) => String(t.languageCode || "").toLowerCase() === manual) ||
        list.find((t) => String(t.languageCode || "").toLowerCase().startsWith(pref)) ||
        list[0]
      );
    }
    return (
      list.find((t) => {
        const c = String(t.languageCode || "").toLowerCase();
        return c === target || c.startsWith(`${target}-`);
      }) ||
      list.find((t) => {
        const c = String(t.languageCode || "").toLowerCase();
        return Boolean(c);
      }) ||
      list[0]
    );
  }

  function orderCaptionTracks(tracks) {
    const list = tracks.filter((t) => t?.baseUrl);
    if (!list.length) return [];
    const preferred = pickTrack(list, "auto", state.settings.targetLang);
    const seen = new Set();
    const out = [];
    for (const t of [preferred, ...list]) {
      if (!t?.baseUrl || seen.has(t.baseUrl)) continue;
      seen.add(t.baseUrl);
      out.push(t);
    }
    return out;
  }

  /**
   * URL timedtext: ưu tiên fetch trong service worker (cùng ngữ cảnh extension như bắt webRequest).
   * Không có runtime → fetch trực tiếp trên trang (credentials omit).
   */
  async function fetchTimedtextBodyViaSw(url, signal) {
    const u = String(url || "");
    const opts = { credentials: "omit" };
    if (signal) opts.signal = signal;
    if (!rtOk()) {
      const r = await fetch(u, opts);
      const text = await r.text();
      return {
        ok: r.ok,
        status: r.status,
        text,
        contentType: r.headers.get("content-type") || ""
      };
    }
    if (signal?.aborted) {
      return { ok: false, status: 0, text: "", contentType: "", error: "aborted" };
    }
    const msgType = MSG_FETCH_TIMEDTEXT_BODY || "FETCH_TIMEDTEXT_BODY";
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: msgType, url: u }, (res) => {
          if (chrome.runtime.lastError) {
            logPipeline("timedtext SW | lastError:", chrome.runtime.lastError.message);
            resolve({
              ok: false,
              status: 0,
              text: "",
              contentType: "",
              error: chrome.runtime.lastError.message
            });
            return;
          }
          resolve({
            ok: Boolean(res?.ok),
            status: typeof res?.status === "number" ? res.status : 0,
            text: typeof res?.text === "string" ? res.text : "",
            contentType: typeof res?.contentType === "string" ? res.contentType : "",
            error: res?.error ? String(res.error) : ""
          });
        });
      } catch (e) {
        resolve({
          ok: false,
          status: 0,
          text: "",
          contentType: "",
          error: String(e?.message || e)
        });
      }
    });
  }

  const subtitleUtils = CORE.createSubtitleUtils
    ? CORE.createSubtitleUtils({
        decodeHtml: env?.decodeHtml || ((x) => String(x || "")),
        getVideo: V.getVideo,
        sleep: V.sleep,
        orderCaptionTracks,
        getTargetLang: () => state.settings?.targetLang || "vi",
        log,
        logPipeline,
        fetchTimedtextBodyViaSw
      })
    : null;
  const fetchTimedtextCues =
    subtitleUtils?.fetchTimedtextCues ||
    (async function fallbackFetchTimedtextCues() {
      return [];
    });
  const loadCuesFromTextTracksOnly =
    subtitleUtils?.loadCuesFromTextTracksOnly ||
    (async function fallbackLoadCuesFromTextTracksOnly() {
      return [];
    });
  const loadCuesFromCaptionTracks =
    subtitleUtils?.loadCuesFromCaptionTracks ||
    (async function fallbackLoadCuesFromCaptionTracks() {
      return null;
    });

  /** Hỏi URL timedtext từ cache session; dừng khi `Date.now() >= endAt` (ms) hoặc `signal` aborted. */
  async function tryTimedtextFromSessionCacheLoop(videoId, methodPrefix, endAt, signal) {
    if (!videoId) return null;
    logPipeline("session cache loop | bắt đầu", methodPrefix, "videoId=" + videoId);
    let n = 0;
    while (Date.now() < endAt) {
      if (signal?.aborted) return null;
      const slice = Math.min(1500, Math.max(400, endAt - Date.now()));
      if (slice < 200) break;
      n += 1;
      const { url: cachedUrl, status: cachedStatus } = await getCachedTimedtextUrl(videoId, slice);
      if (signal?.aborted) return null;
      if (cachedUrl) {
        if (timedtextSignedUrlLikelyStale(cachedUrl)) {
          await V.sleep(280);
          continue;
        }
        const lastAt = Number(timedtextUrlSeenAt.get(cachedUrl) || 0);
        const now = Date.now();
        if (now - lastAt < TIMEDTEXT_SAME_URL_RETRY_GAP_MS) {
          await V.sleep(500);
          continue;
        }
        timedtextUrlSeenAt.set(cachedUrl, now);
        if (signal?.aborted) return null;
        if (typeof cachedStatus === "number" && cachedStatus >= 400) {
          logPipeline("session cache | HTTP capture " + cachedStatus + " — vẫn thử fetch");
          log("B1 | cache timedtext capture status=" + cachedStatus + " — vẫn thử fetchTimedtextCues");
        }
        logPipeline("session cache | fetchTimedtext #" + n + " …");
        const c = await fetchTimedtextCues(cachedUrl, { signal });
        const out = returnIfCues(`${methodPrefix} #${n}`, videoId, c, "");
        if (out) {
          logPipeline("session cache | OK method=" + methodPrefix + " #" + n);
          return out;
        }
        logPipeline("session cache | 0 cue sau parse #" + n);
        await V.sleep(320);
      } else {
        await V.sleep(450);
      }
    }
    logPipeline("session cache loop | hết ngân sách", methodPrefix);
    return null;
  }

  function captionTracksFromPr(pr) {
    return pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  }

  /** Video đã có ít nhất một textTrack có cues. */
  function videoTextTracksHaveCues() {
    const video = V.getVideo();
    if (!video?.textTracks?.length) return false;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const tr = video.textTracks[i];
      if (tr.kind !== "subtitles" && tr.kind !== "captions") continue;
      try {
        const n = tr.cues && tr.cues.length;
        if (typeof n === "number" && n > 0) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  /** Đã gắn track phụ đề/CC trên video (có thể cues chưa nạp). */
  function videoHasCaptionTracksAttached() {
    const video = V.getVideo();
    if (!video?.textTracks?.length) return false;
    for (let i = 0; i < video.textTracks.length; i += 1) {
      const tr = video.textTracks[i];
      if (tr.kind === "subtitles" || tr.kind === "captions") return true;
    }
    return false;
  }

  /**
   * Ưu tiên nút CC trong `#movie_player` — `document.querySelector('button.ytp-subtitles-button')`
   * có thể trúng nút ẩn/miniplayer khác `aria-pressed` → làm mờ nút Dịch nhầm.
   */
  function queryYtpSubtitlesButton() {
    const tryIn = (root) => {
      if (!root?.querySelector) return null;
      const b = root.querySelector("button.ytp-subtitles-button");
      return b || null;
    };
    const mp = document.querySelector("#movie_player");
    const inMp = tryIn(mp);
    if (inMp) return inMp;
    const players = document.querySelectorAll("#movie_player, .html5-video-player");
    for (let i = 0; i < players.length; i += 1) {
      const b = tryIn(players[i]);
      if (b) {
        const r = b.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) return b;
      }
    }
    const all = document.querySelectorAll("button.ytp-subtitles-button");
    for (let j = 0; j < all.length; j += 1) {
      const b = all[j];
      const r = b.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) return b;
    }
    return all.length ? all[0] : null;
  }

  /**
   * Đồng bộ sáng/mờ nút Dịch với `aria-pressed` nút CC (bật CC = sáng hơn).
   */
  function applyTranslateButtonCcMirror(extBtn) {
    if (!extBtn) return;
    const ytp = queryYtpSubtitlesButton();
    if (!ytp) {
      extBtn.removeAttribute("data-cc-pressed-mirror");
      return;
    }
    if (ytp.getAttribute("aria-pressed") === "true") extBtn.setAttribute("data-cc-pressed-mirror", "1");
    else if (ytp.getAttribute("aria-pressed") === "false") extBtn.setAttribute("data-cc-pressed-mirror", "0");
    else extBtn.removeAttribute("data-cc-pressed-mirror");
  }

  /**
   * Chỉ nút CC: `aria-disabled="true"` → không có tín hiệu; `aria-pressed="true"` → có.
   * @returns {boolean|null}
   */
  function ytpSubtitlesButtonCaptionUiHint() {
    const btn = queryYtpSubtitlesButton();
    if (!btn) return null;
    try {
      if (btn.getAttribute("aria-disabled") === "true") return false;
      if (btn.getAttribute("aria-pressed") === "true") return true;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Nút CC trên player: `aria-disabled="true"` → YouTube báo không có phụ đề/CC cho video này.
   * Luôn ưu tiên trước latch `navStickySubtitlesOk` trong playback để không bấm Dịch nhầm.
   */
  function captionUiExplicitlyUnsupported() {
    return ytpSubtitlesButtonCaptionUiHint() === false;
  }

  /**
   * Cho phép bật nút Dịch: track; hoặc nút CC (aria-disabled / aria-pressed); hoặc playerResponse.
   */
  function hasSubtitlesSignal() {
    if (videoTextTracksHaveCues()) return true;
    if (videoHasCaptionTracksAttached()) return true;

    const uiHint = ytpSubtitlesButtonCaptionUiHint();
    if (uiHint === false) return false;
    if (uiHint === true) return true;

    const pr = state.snapshot?.playerResponse;
    return captionTracksFromPr(pr).length > 0;
  }

  /**
   * Chờ URL timedtext trong cache session; gửi qua `fetchTimedtextCues` (subtitle-utils: fmt, 5 lần, 429 bỏ tlang).
   * Mọi lỗi (429, mạng, URL invalid, reject…) đều bắt — chờ tiếp trong ngân sách thời gian.
   */
  async function waitUntilSubtitlesReadyAfterCc(videoId, maxWaitMs) {
    const max = Math.max(4000, Math.min(120000, Number(maxWaitMs) || 60000));
    const t0 = Date.now();
    logPipeline("B0.5 | chờ timedtext (maxWaitMs=" + max + ") videoId=" + (videoId || "—"));
    log("PIPELINE | B0.5 — chờ timedtext cache session → fetchTimedtextCues…");
    await V.sleep(500);
    while (Date.now() - t0 < max) {
      if (!videoId) {
        await V.sleep(420);
        continue;
      }
      try {
        const { url, status } = await getCachedTimedtextUrl(videoId, 1200);
        if (url && typeof status === "number") {
          logPipeline("B0.5 | cache HTTP " + status + " url.len=" + url.length);
        }
        if (url) {
          const cues = await fetchTimedtextCues(url, {});
          if (cues.length) {
            logPipeline("B0.5 | warmup OK cues=" + cues.length);
            log("PIPELINE | B0.5 OK — cues=" + cues.length);
            await V.sleep(250);
            return;
          }
          logPipeline("B0.5 | fetch timedtext 0 cue — chờ thêm");
          await V.sleep(320);
          continue;
        }
        await V.sleep(420);
      } catch (e) {
        logPipeline("B0.5 | lỗi:", String(e?.message || e));
        log("PIPELINE | B0.5 — lỗi (429/mạng/…):", String(e?.message || e));
        await V.sleep(500);
      }
    }
    logPipeline("B0.5 | hết thời gian — chuyển B1");
    log("PIPELINE | B0.5 — hết thời gian chờ, vẫn chạy B1");
  }

  async function loadSubtitleCues() {
    const loadAc = new AbortController();
    const loadSignal = loadAc.signal;
    try {
      const deadline = Date.now() + B1_TOTAL_BUDGET_MS;
      const earlyId = V.videoIdFromUrlOnly();
      logPipeline(
        "B1 | bắt đầu tải phụ đề | budgetMs=" + B1_TOTAL_BUDGET_MS + " | earlyId=" + (earlyId || "—")
      );

      if (earlyId && leftMs(deadline) > 800) {
        logPipeline("B1 | (1) thử webRequest-cache sớm");
        const earlyEnd = Math.min(deadline, Date.now() + 12000);
        const hit = await tryTimedtextFromSessionCacheLoop(earlyId, "webRequest-cache (đầu)", earlyEnd, loadSignal);
        if (hit) return hit;
        logPipeline("B1 | (1) không có kết quả");
      }

      if (leftMs(deadline) > 400) {
        logPipeline("B1 | (2) HTMLVideoElement.textTracks (retry delays)");
        const out = await loadTextTracksWithRetries(
          [550, 1100, 1900, 3000, 4800],
          "HTMLVideoElement.textTracks",
          earlyId || state.snapshot?.videoId || "—"
        );
        if (out) return out;
        logPipeline("B1 | (2) textTracks không có cue");
      }

      const snapWait = Math.min(9500, leftMs(deadline));
      logPipeline("B1 | (3) chờ snapshot playerResponse | snapWaitMs=" + snapWait);
      const snapOk = snapWait > 120 ? await V.waitSnapshot(snapWait) : false;
      let pr = state.snapshot?.playerResponse;
      const videoId = V.resolveVideoId(pr) || earlyId;
      if (!videoId) {
        logPipeline("B1 | lỗi: không resolve videoId");
        throw new Error("Không xác định được video ID — F5 hoặc mở đúng link watch/shorts.");
      }
      if (!snapOk) {
        logPipeline("B1 | snapshot chậm/timeout — vẫn fallback videoId=" + videoId);
        log("B1 | playerResponse chậm/timeout — vẫn thử fallback, videoId=", videoId);
      }

      let tracks = captionTracksFromPr(pr);
      logPipeline("B1 | captionTracks từ playerResponse | n=" + tracks.length + " videoId=" + videoId);

      const cachePollUntil = Math.min(deadline, Date.now() + 16000);
      const phase1Timeout = Math.min(24000, leftMs(deadline));
      logPipeline(
        "B1 | (4) firstSuccess phase1 | timeoutMs=" + phase1Timeout + " | song song: captionTracks, cache, textTracks, lib"
      );
      const phase1 = await firstSuccess(
        [
          async (sig) => {
            if (!tracks.length) return null;
            const rCap = await loadCuesFromCaptionTracks(tracks, { signal: sig });
            return rCap?.cues?.length ? rCap : null;
          },
          async (sig) => tryTimedtextFromSessionCacheLoop(videoId, "webRequest-cache (p1)", cachePollUntil, sig),
          async () =>
            loadTextTracksWithRetries([800, 1600, 2800, 4500, 7000], "HTMLVideoElement.textTracks (p1)", videoId),
          async () => {
            const byLib = await loadCuesFromYoutubeTranscriptLib(videoId);
            return byLib?.cues?.length ? byLib : null;
          }
        ],
        Math.max(600, phase1Timeout)
      );
      if (phase1) return phase1;
      logPipeline("B1 | (4) phase1 thất bại — thử làn 2 | còn ms=" + leftMs(deadline));

      if (leftMs(deadline) > 700) {
        logPipeline("B1 | (5) chờ snapshot làn 2");
        log("B1 | làn 2 — chờ snapshot / thử lại…");
        const w2 = Math.min(5500, leftMs(deadline));
        if (w2 > 200) await V.waitSnapshot(w2);
        pr = state.snapshot?.playerResponse;
        tracks = captionTracksFromPr(pr);
        logPipeline("B1 | (5) sau chờ | captionTracks n=" + tracks.length);
      }

      if (leftMs(deadline) > 500) {
        const cacheEnd2 = Math.min(deadline, Date.now() + 14000);
        const phase2Timeout = Math.min(32000, leftMs(deadline));
        logPipeline("B1 | (6) firstSuccess phase2 | timeoutMs=" + phase2Timeout);
        const phase2 = await firstSuccess(
          [
            async (sig) => {
              if (!tracks.length) return null;
              const rCap = await loadCuesFromCaptionTracks(tracks, { signal: sig });
              return rCap?.cues?.length ? rCap : null;
            },
            async (sig) => tryTimedtextFromSessionCacheLoop(videoId, "webRequest-cache (L2)", cacheEnd2, sig),
            async () =>
              loadTextTracksWithRetries([3500, 6500, 10000], "HTMLVideoElement.textTracks (L2)", videoId),
            async () => {
              const byLib = await loadCuesFromYoutubeTranscriptLib(videoId);
              return byLib?.cues?.length ? byLib : null;
            }
          ],
          Math.max(600, phase2Timeout)
        );
        if (phase2) return phase2;
        logPipeline("B1 | (6) phase2 thất bại");
      }

      if (leftMs(deadline) > 400) {
        logPipeline("B1 | (7) textTracks cuối (retry dài)");
        const out = await loadTextTracksWithRetries(
          [2800, 6000, 9500],
          "HTMLVideoElement.textTracks (cuối)",
          videoId
        );
        if (out) return out;
        logPipeline("B1 | (7) vẫn 0 cue");
      }

      if (leftMs(deadline) > 400) {
        logPipeline("B1 | (8) session cache L3 (cuối)");
        const lastEnd = Math.min(deadline, Date.now() + 11000);
        const last = await tryTimedtextFromSessionCacheLoop(videoId, "webRequest-cache (L3)", lastEnd, loadSignal);
        if (last) return last;
        logPipeline("B1 | (8) L3 không có kết quả");
      }

      if (!tracks.length) {
        logPipeline("B1 | THROW: không có captionTracks trong playerResponse");
        throw new Error(
          "Player không có danh sách phụ đề.\n\n" +
            NEWBIE_SUBTITLE_GUIDE +
            "\n\nSau đó F5 và bấm Dịch lại."
        );
      }
      logPipeline("B1 | THROW: hết cách lấy cue (đã có track list nhưng fetch rỗng)");
      throw new Error("Lấy phụ đề quá 10 giây hoặc thất bại.\n\n" + NEWBIE_SUBTITLE_GUIDE + "\n\nSau đó F5 rồi bấm Dịch lại.");
    } finally {
      try {
        loadAc.abort();
      } catch {
        /* ignore */
      }
    }
  }

  Object.assign(V, {
    logSubtitleOk,
    returnIfCues,
    pickTrack,
    orderCaptionTracks,
    loadSubtitleCues,
    waitUntilSubtitlesReadyAfterCc,
    videoTextTracksHaveCues,
    applyTranslateButtonCcMirror,
    ytpSubtitlesButtonCaptionUiHint,
    captionUiExplicitlyUnsupported,
    hasSubtitlesSignal
  });
})();
