import { fetchTranscript } from "./vendor/youtube-transcript.esm.js";
import {
  STORAGE_KEY,
  MESSAGE_TYPES,
  TIMEDTEXT_SESSION_KEY,
  normalizeTargetLang,
  buildPersistedStoragePayload
} from "../../content/dubbing/core/extension-settings-esm.js";

const MAX_VIDEO_CACHE = 40;

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

/**
 * Bắt mọi request hoàn tất tới /api/timedtext — ghi cả HTTP lỗi (429, 403, …) để content biết URL + status.
 */
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.tabId == null || details.tabId < 0) return;
    const vid = videoIdFromTimedtextUrl(details.url);
    if (!vid) return;

    const code = Number(details.statusCode);
    const status = Number.isFinite(code) ? code : 0;
    const data = await chrome.storage.session.get(TIMEDTEXT_SESSION_KEY);
    const map = { ...(data[TIMEDTEXT_SESSION_KEY] || {}) };
    map[vid] = { url: details.url, ts: Date.now(), status };

    const ids = Object.keys(map);
    if (ids.length > MAX_VIDEO_CACHE + 8) {
      ids.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
      for (let i = 0; i < ids.length - MAX_VIDEO_CACHE; i += 1) {
        delete map[ids[i]];
      }
    }
    await chrome.storage.session.set({ [TIMEDTEXT_SESSION_KEY]: map });
  },
  {
    urls: [
      "*://*.youtube.com/api/timedtext*",
      "*://*.youtube-nocookie.com/api/timedtext*"
    ]
  }
);

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

chrome.runtime.onInstalled.addListener(() => ensureSettings());

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

  if (msg?.type === MESSAGE_TYPES.fetchYoutubeTranscript) {
    const videoId = String(msg.payload?.videoId || "").trim();
    const langRaw = msg.payload?.lang;
    if (!videoId) {
      sendResponse({ ok: false, error: "no_video_id", cues: [], lang: "" });
      return false;
    }
    (async () => {
      try {
        const cfg = { fetch: extensionCleanFetch };
        if (langRaw && String(langRaw).toLowerCase() !== "auto") {
          cfg.lang = String(langRaw);
        }
        const items = await fetchTranscript(videoId, cfg);
        const { cues, lang } = transcriptLibItemsToCues(items);
        if (!cues.length && Array.isArray(items) && items.length) {
          console.warn(
            "[YTDUB-v3][SW] youtube-transcript có",
            items.length,
            "mục nhưng 0 cue sau chuẩn hóa — có thể đổi format timedtext"
          );
        }
        sendResponse({
          ok: cues.length > 0,
          cues,
          lang,
          error: cues.length ? "" : "empty_transcript"
        });
      } catch (e) {
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
