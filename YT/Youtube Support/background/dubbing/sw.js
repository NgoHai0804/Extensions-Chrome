import { fetchTranscript } from "./vendor/youtube-transcript.esm.js";
import {
  STORAGE_KEY,
  MESSAGE_TYPES,
  TIMEDTEXT_SESSION_KEY,
  normalizeTargetLang,
  buildPersistedStoragePayload
} from "../../content/dubbing/core/extension-settings-esm.js";
import { LICENSE_RECHECK_MESSAGE_TYPE } from "../../shared/settings.js";

const MAX_VIDEO_CACHE = 40;

/** Cùng chu kỳ 30 phút với `LICENSE_CHECK_INTERVAL_MS` — gửi tới mọi tab YouTube để content gọi API (SW không tính được device key). */
const LICENSE_ALARM_NAME = "ytdub_license_tick";

/** Google translate_tts — tối đa ~200 ký tự/request (ASCII); an toàn cho Unicode. */
const GTTS_MAX_CHARS = 200;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Chuẩn hóa output thư viện youtube-transcript → giây (thử scale đảo nếu lọc hết). */
function transcriptLibItemsToCues(items) {
  if (!Array.isArray(items) || !items.length) return { cues: [], lang: "" };
  const lang = String(items.find((i) => i?.lang)?.lang || "");

  function build(scale) {
    return items
      .map((item) => {
        const start = Number(item.offset) * scale;
        const end = start + Number(item.duration) * scale;
        const text = String(item.text || "")
          .replace(/\n+/g, " ")
          .trim();
        return { start, end, text };
      })
      .filter((c) => c.text && c.end > c.start && Number.isFinite(c.start));
  }

  const inMs = items.some((i) => {
    const d = Number(i?.duration);
    const o = Number(i?.offset);
    return (Number.isInteger(d) && d > 100) || (Number.isInteger(o) && o > 500);
  });
  const primary = inMs ? 0.001 : 1;
  let cues = build(primary);
  if (!cues.length) {
    cues = build(primary === 1 ? 0.001 : 1);
  }
  return { cues, lang };
}

async function ensureSettings() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  if (!r[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: buildPersistedStoragePayload({}) });
  }
}

/**
 * youtube-transcript gắn User-Agent giả (Chrome 85 / Android app) — dễ bị Google trả trang sorry/bot.
 * Dùng fetch mặc định của extension (không set UA), không gửi cookie chéo origin.
 */
function extensionCleanFetch(input, init = {}) {
  const next = { ...init };
  const h = new Headers(next.headers || undefined);
  h.delete("User-Agent");
  h.delete("user-agent");
  next.headers = h;
  next.credentials = "omit";
  if (next.redirect == null) next.redirect = "follow";
  return fetch(input, next);
}

function videoIdFromTimedtextUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (
      u.searchParams.get("v") ||
      u.searchParams.get("video_id") ||
      u.searchParams.get("id") ||
      ""
    );
  } catch {
    return "";
  }
}

/** Càng nhiều param quan trọng (ký, hết hạn, fmt, ngôn ngữ…) → điểm càng cao — giữ URL đủ để fetch có nội dung. */
function timedtextUrlParamScore(urlStr) {
  try {
    const u = new URL(String(urlStr || ""));
    const sp = u.searchParams;
    let score = sp.toString().length;
    const has = (k) => {
      const v = sp.get(k);
      return v != null && String(v).length > 0;
    };
    if (has("signature") || has("sig")) score += 500;
    if (has("pot") || has("expire")) score += 400;
    if (has("caps") || has("name")) score += 120;
    if (has("fmt")) score += 80;
    if (has("lang") || has("lang_code")) score += 60;
    if (has("tlang")) score += 40;
    if (has("v") || has("video_id") || has("id")) score += 30;
    return score;
  } catch {
    return -1;
  }
}

function pickBetterTimedtextUrl(prevUrl, candidateUrl) {
  if (!candidateUrl) return prevUrl || "";
  if (!prevUrl) return candidateUrl;
  const sa = timedtextUrlParamScore(prevUrl);
  const sb = timedtextUrlParamScore(candidateUrl);
  if (sb > sa) return candidateUrl;
  if (sb < sa) return prevUrl;
  return String(candidateUrl).length >= String(prevUrl).length ? candidateUrl : prevUrl;
}

async function mergeTimedtextSession(vid, urlCandidate, statusOrNull) {
  if (!vid || !urlCandidate) return;
  const data = await chrome.storage.session.get(TIMEDTEXT_SESSION_KEY);
  const map = { ...(data[TIMEDTEXT_SESSION_KEY] || {}) };
  const prev = map[vid];
  const nextUrl = pickBetterTimedtextUrl(prev?.url || "", urlCandidate);
  let status = prev?.status ?? null;
  if (statusOrNull != null && Number.isFinite(Number(statusOrNull))) {
    status = Number(statusOrNull);
  }
  map[vid] = { url: nextUrl, ts: Date.now(), status };

  const ids = Object.keys(map);
  if (ids.length > MAX_VIDEO_CACHE + 8) {
    ids.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
    for (let i = 0; i < ids.length - MAX_VIDEO_CACHE; i += 1) {
      delete map[ids[i]];
    }
  }
  await chrome.storage.session.set({ [TIMEDTEXT_SESSION_KEY]: map });
}

/** Chỉ cho phép fetch timedtext YouTube — không dùng làm proxy tùy ý. */
function isYoutubeTimedtextUrl(urlStr) {
  try {
    const u = new URL(String(urlStr || ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (!h.endsWith("youtube.com") && !h.endsWith("youtube-nocookie.com")) return false;
    return u.pathname.includes("/api/timedtext");
  } catch {
    return false;
  }
}

const TIMEDTEXT_URLS = [
  "*://*.youtube.com/api/timedtext*",
  "*://*.youtube-nocookie.com/api/timedtext*"
];

/** Trước khi gửi: chỉ XHR/fetch — đúng URL đầy đủ query (fmt, lang, sig, …). */
const TIMEDTEXT_BEFORE_FILTER = {
  urls: TIMEDTEXT_URLS,
  types: ["xmlhttprequest"]
};

/** Sau khi xong: không lọc types — vẫn ghi HTTP status dù Chrome gán loại khác. */
const TIMEDTEXT_COMPLETED_FILTER = { urls: TIMEDTEXT_URLS };

/**
 * Bắt timedtext:
 * - onBeforeRequest: URL đúng như trình duyệt gửi (đủ query: fmt, lang, sig, expire…).
 * - onCompleted: HTTP status (429, …) + merge URL (chọn bản param đầy đủ hơn).
 */
function registerTimedtextWebRequestCapture() {
  const wr = typeof chrome !== "undefined" ? chrome.webRequest : undefined;
  if (!wr?.onCompleted?.addListener) {
    try {
      const inSw =
        typeof ServiceWorkerGlobalScope !== "undefined" &&
        typeof self !== "undefined" &&
        self instanceof ServiceWorkerGlobalScope;
      if (inSw) {
        console.warn(
          "[YTDUB-v3][SW] chrome.webRequest không khả dụng — bỏ qua cache timedtext (kiểm tra quyền manifest)."
        );
      }
    } catch {
      /* ignore */
    }
    return;
  }

  if (wr.onBeforeRequest?.addListener) {
    wr.onBeforeRequest.addListener(
      (details) => {
        if (details.tabId == null || details.tabId < 0) return;
        const vid = videoIdFromTimedtextUrl(details.url);
        if (!vid) return;
        void mergeTimedtextSession(vid, details.url, null);
      },
      TIMEDTEXT_BEFORE_FILTER
    );
  }

  wr.onCompleted.addListener(
    async (details) => {
      if (details.tabId == null || details.tabId < 0) return;
      const vid = videoIdFromTimedtextUrl(details.url);
      if (!vid) return;

      const code = Number(details.statusCode);
      const status = Number.isFinite(code) ? code : 0;
      await mergeTimedtextSession(vid, details.url, status);
    },
    TIMEDTEXT_COMPLETED_FILTER
  );
}

registerTimedtextWebRequestCapture();

/** B2 — chỉ dịch, không động vào phụ đề hay TTS */
async function translateOne(text, sourceLang, targetLang) {
  const endpoints = [
    "https://translate.googleapis.com/translate_a/single",
    "https://clients5.google.com/translate_a/t"
  ];
  let last = null;
  for (const endpoint of endpoints) {
    try {
      const url =
        endpoint +
        `?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const out = (data?.[0] || [])
        .map((c) => c?.[0] || "")
        .join("")
        .trim();
      if (out) return out;
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
  return text;
}

function ensureLicenseAlarm() {
  try {
    chrome.alarms.create(LICENSE_ALARM_NAME, { periodInMinutes: 30 });
  } catch (e) {
    console.warn("[YTDUB-v3][SW] license alarm", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSettings();
  ensureLicenseAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureLicenseAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== LICENSE_ALARM_NAME) return;
  const urlPatterns = [
    "*://*.youtube.com/*",
    "*://youtu.be/*",
    "*://*.youtube-nocookie.com/*"
  ];
  try {
    chrome.tabs.query({ url: urlPatterns }, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      for (let i = 0; i < tabs.length; i += 1) {
        const id = tabs[i].id;
        if (id == null || id < 0) continue;
        try {
          chrome.tabs.sendMessage(id, { type: LICENSE_RECHECK_MESSAGE_TYPE }, () => {
            void chrome.runtime.lastError;
          });
        } catch {
          /* ignore */
        }
      }
    });
  } catch {
    /* ignore */
  }
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type === MESSAGE_TYPES.ttsGoogleGtx) {
    const raw = String(msg.payload?.text ?? "").trim();
    const tl = String(msg.payload?.tl || "vi").trim() || "vi";
    if (!raw) {
      sendResponse({ ok: false, error: "empty" });
      return false;
    }
    const text = raw.slice(0, GTTS_MAX_CHARS);
    (async () => {
      const endpoints = ["https://translate.googleapis.com/translate_tts", "https://clients5.google.com/translate_tts"];
      let lastErr = "";
      for (let i = 0; i < endpoints.length; i += 1) {
        const base = endpoints[i];
        try {
          const url =
            base +
            "?ie=UTF-8&client=gtx&q=" +
            encodeURIComponent(text) +
            "&tl=" +
            encodeURIComponent(tl);
          const res = await fetch(url, { redirect: "follow" });
          const finalUrl = String(res.url || "");
          if (finalUrl.includes("/sorry/") || finalUrl.includes("google.com/sorry")) {
            lastErr = `blocked_sorry@${base}`;
            continue;
          }
          if (!res.ok) {
            lastErr = `http_${res.status}@${base}`;
            continue;
          }
          const buf = await res.arrayBuffer();
          if (!buf.byteLength) {
            lastErr = `empty_audio@${base}`;
            continue;
          }
          sendResponse({
            ok: true,
            mime: res.headers.get("content-type") || "audio/mpeg",
            base64: arrayBufferToBase64(buf)
          });
          return;
        } catch (e) {
          lastErr = `${String(e?.message || e)}@${base}`;
        }
      }
      sendResponse({ ok: false, error: lastErr || "tts_fetch_failed" });
    })();
    return true;
  }

  if (msg?.type === MESSAGE_TYPES.getCachedTimedtext) {
    const videoId = String(msg.videoId || "");
    if (!videoId) {
      sendResponse({ ok: false, url: "" });
      return false;
    }
    (async () => {
      const data = await chrome.storage.session.get(TIMEDTEXT_SESSION_KEY);
      const map = data[TIMEDTEXT_SESSION_KEY] || {};
      const hit = map[videoId];
      const st = hit?.status;
      sendResponse({
        ok: true,
        url: hit?.url ? String(hit.url) : "",
        status: typeof st === "number" && Number.isFinite(st) ? st : null
      });
    })();
    return true;
  }

  /** Content gửi URL timedtext (từ webRequest cache hoặc baseUrl player) — fetch trong SW, trả body để parse ở tab. */
  if (msg?.type === MESSAGE_TYPES.fetchTimedtextBody) {
    const url = String(msg.url || "").trim();
    if (!isYoutubeTimedtextUrl(url)) {
      sendResponse({ ok: false, status: 0, text: "", contentType: "", error: "bad_url" });
      return false;
    }
    (async () => {
      try {
        const res = await extensionCleanFetch(url);
        const text = await res.text();
        sendResponse({
          ok: res.ok,
          status: res.status,
          text,
          contentType: res.headers.get("content-type") || "",
          error: ""
        });
      } catch (e) {
        sendResponse({
          ok: false,
          status: 0,
          text: "",
          contentType: "",
          error: String(e?.message || e)
        });
      }
    })();
    return true;
  }

  if (msg?.type === MESSAGE_TYPES.fetchYoutubeTranscript) {
    const videoId = String(msg.payload?.videoId || "").trim();
    const langRaw = msg.payload?.lang;
    if (!videoId) {
      sendResponse({ ok: false, error: "no_video_id", cues: [], lang: "" });
      return false;
    }
    (async () => {
      try {
        console.log("[YTDUB-v3][SUB][SW] youtube-transcript | bắt đầu videoId=" + videoId);
        const cfg = { fetch: extensionCleanFetch };
        if (langRaw && String(langRaw).toLowerCase() !== "auto") {
          cfg.lang = String(langRaw);
          console.log("[YTDUB-v3][SUB][SW] youtube-transcript | lang=" + cfg.lang);
        }
        const items = await fetchTranscript(videoId, cfg);
        console.log(
          "[YTDUB-v3][SUB][SW] youtube-transcript | fetchTranscript xong items=" + (Array.isArray(items) ? items.length : "—")
        );
        const { cues, lang } = transcriptLibItemsToCues(items);
        if (!cues.length && Array.isArray(items) && items.length) {
          console.warn(
            "[YTDUB-v3][SW] youtube-transcript có",
            items.length,
            "mục nhưng 0 cue sau chuẩn hóa — có thể đổi format timedtext"
          );
        }
        console.log(
          "[YTDUB-v3][SUB][SW] youtube-transcript | cues=" + cues.length + " lang=" + (lang || "—")
        );
        sendResponse({
          ok: cues.length > 0,
          cues,
          lang,
          error: cues.length ? "" : "empty_transcript"
        });
      } catch (e) {
        console.warn(
          "[YTDUB-v3][SUB][SW] youtube-transcript | lỗi videoId=" + videoId,
          String(e?.message || e)
        );
        console.warn("[YTDUB-v3][service-worker] youtube-transcript fail", videoId, String(e?.message || e));
        sendResponse({
          ok: false,
          cues: [],
          lang: "",
          error: String(e?.message || e)
        });
      }
    })();
    return true;
  }

  if (msg?.type !== MESSAGE_TYPES.translateTexts) return false;

  const { texts, sourceLang, targetLang } = msg.payload || {};
  if (!Array.isArray(texts)) {
    sendResponse({ ok: false, error: "payload", lines: [] });
    return false;
  }

  const sl = String(sourceLang || "auto");
  const tl = normalizeTargetLang(targetLang);

  (async () => {
    const lines = [];
    try {
      for (let i = 0; i < texts.length; i += 1) {
        const raw = String(texts[i] ?? "");
        if (!raw.trim()) {
          lines.push("");
          continue;
        }
        try {
          const t = await translateOne(raw, sl, tl);
          lines.push(t || raw);
        } catch {
          lines.push(raw);
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      sendResponse({ ok: true, lines });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e), lines });
    }
  })();

  return true;
});
