/** Đồng bộ default/merge với extension-settings-esm.js (popup + SW). */
(function ytdubCoreSettings() {
  const core = (window.__YTDUB_CORE = window.__YTDUB_CORE || {});

  const DEFAULT_SETTINGS = {
    sourceLang: "auto",
    targetLang: "vi",
    showSubtitleOverlay: true,
    youtubeAriaFocusFix: false,
    speechVolume: 1,
    /** Giây cắt hẳn ở cuối file TTS + chừa trước `end` cue trên timeline video. */
    ttsEndCutSec: 0.35,
    backgroundVideoVolume: 0.2,
    voiceDuckVideoVolume: 0.3,
    voiceUnduckRampSec: 1
  };

  const SUPPORTED_TARGET_LANGS = [
    "ar",
    "bn",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "fa",
    "fi",
    "fr",
    "he",
    "hi",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "ro",
    "ru",
    "sv",
    "th",
    "tl",
    "tr",
    "uk",
    "vi",
    "zh-CN",
    "zh-TW"
  ];

  function normalizeTargetLang(raw) {
    const fallback = DEFAULT_SETTINGS.targetLang;
    if (raw == null) return fallback;
    let s = String(raw).trim().toLowerCase().replace(/_/g, "-");
    if (!s) return fallback;

    const aliases = {
      vn: "vi",
      vie: "vi",
      "vi-vn": "vi",
      vietnamese: "vi",
      "tiếng việt": "vi",
      "tieng viet": "vi",
      eng: "en",
      english: "en",
      "en-us": "en",
      "en-gb": "en",
      ja: "ja",
      japanese: "ja",
      jp: "ja",
      ko: "ko",
      korean: "ko",
      fr: "fr",
      french: "fr",
      de: "de",
      german: "de",
      es: "es",
      spanish: "es",
      español: "es",
      espanol: "es",
      tr: "tr",
      turkish: "tr",
      "tr-tr": "tr",
      zh: "zh-CN",
      "zh-cn": "zh-CN",
      zhcn: "zh-CN",
      "zh-hans": "zh-CN",
      "zh-sg": "zh-CN",
      cn: "zh-CN",
      chinese: "zh-CN",
      mandarin: "zh-CN",
      "zh-tw": "zh-TW",
      zhtw: "zh-TW",
      "zh-hant": "zh-TW",
      "zh-hk": "zh-TW",
      "zh-mo": "zh-TW",
      tw: "zh-TW",
      it: "it",
      italian: "it",
      italiano: "it",
      pt: "pt",
      "pt-br": "pt",
      "pt-pt": "pt",
      portuguese: "pt",
      português: "pt",
      portugues: "pt",
      ru: "ru",
      russian: "ru",
      ar: "ar",
      arabic: "ar",
      hi: "hi",
      hindi: "hi",
      nl: "nl",
      dutch: "nl",
      nederlands: "nl",
      pl: "pl",
      polish: "pl",
      polski: "pl",
      uk: "uk",
      ukrainian: "uk",
      українська: "uk",
      id: "id",
      indonesian: "id",
      th: "th",
      thai: "th",
      sv: "sv",
      swedish: "sv",
      svenska: "sv",
      da: "da",
      danish: "da",
      dansk: "da",
      fi: "fi",
      finnish: "fi",
      suomi: "fi",
      no: "no",
      nb: "no",
      nn: "no",
      norwegian: "no",
      norsk: "no",
      cs: "cs",
      czech: "cs",
      čeština: "cs",
      el: "el",
      greek: "el",
      ελληνικά: "el",
      hu: "hu",
      hungarian: "hu",
      magyar: "hu",
      ro: "ro",
      romanian: "ro",
      română: "ro",
      he: "he",
      hebrew: "he",
      עברית: "he",
      fa: "fa",
      persian: "fa",
      farsi: "fa",
      فارسی: "fa",
      bn: "bn",
      bengali: "bn",
      বাংলা: "bn",
      tl: "tl",
      fil: "tl",
      filipino: "tl",
      tagalog: "tl",
      ms: "ms",
      malay: "ms",
      melayu: "ms"
    };
    if (aliases[s]) return aliases[s];

    const byLower = new Map(SUPPORTED_TARGET_LANGS.map((code) => [code.toLowerCase(), code]));
    if (byLower.has(s)) return byLower.get(s);
    return fallback;
  }

  function normalizeTtsVoiceGender(raw) {
    return "auto";
  }

  function mergeExtensionSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    merged.sourceLang = "auto";
    delete merged.preferAutoCc;
    delete merged.captionKind;
    delete merged.ttsEngine;
    merged.targetLang = normalizeTargetLang(merged.targetLang);

    merged.ttsEndCutSec = Number(merged.ttsEndCutSec);
    if (!Number.isFinite(merged.ttsEndCutSec)) merged.ttsEndCutSec = DEFAULT_SETTINGS.ttsEndCutSec;
    merged.ttsEndCutSec = Math.min(1.0, Math.max(0, merged.ttsEndCutSec));

    merged.speechVolume = Number(merged.speechVolume);
    if (!Number.isFinite(merged.speechVolume)) merged.speechVolume = DEFAULT_SETTINGS.speechVolume;
    merged.speechVolume = Math.min(2, Math.max(0, merged.speechVolume));

    const subOn = merged.showSubtitleOverlay;
    merged.showSubtitleOverlay =
      subOn === false || subOn === "false" || subOn === 0 || subOn === "0" ? false : true;

    const ariaFix = merged.youtubeAriaFocusFix;
    merged.youtubeAriaFocusFix =
      ariaFix === true || ariaFix === "true" || ariaFix === 1 || ariaFix === "1";

    merged.backgroundVideoVolume = Number(merged.backgroundVideoVolume);
    if (!Number.isFinite(merged.backgroundVideoVolume)) {
      merged.backgroundVideoVolume = DEFAULT_SETTINGS.backgroundVideoVolume;
    }
    merged.backgroundVideoVolume = Math.min(1, Math.max(0, merged.backgroundVideoVolume));
    merged.voiceDuckVideoVolume = Number(merged.voiceDuckVideoVolume);
    if (!Number.isFinite(merged.voiceDuckVideoVolume)) {
      merged.voiceDuckVideoVolume = DEFAULT_SETTINGS.voiceDuckVideoVolume;
    }
    merged.voiceDuckVideoVolume = Math.min(1, Math.max(0, merged.voiceDuckVideoVolume));
    merged.voiceUnduckRampSec = Number(merged.voiceUnduckRampSec);
    if (!Number.isFinite(merged.voiceUnduckRampSec)) {
      merged.voiceUnduckRampSec = DEFAULT_SETTINGS.voiceUnduckRampSec;
    }
    merged.voiceUnduckRampSec = Math.min(5, Math.max(0, merged.voiceUnduckRampSec));
    delete merged.speechPitch;
    delete merged.ttsVoiceGender;
    return merged;
  }

  core.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  core.SUPPORTED_TARGET_LANGS = SUPPORTED_TARGET_LANGS;
  core.normalizeTargetLang = normalizeTargetLang;
  core.mergeExtensionSettings = mergeExtensionSettings;

  /** YouTube: Trusted Types — không dùng innerHTML trên document của trang. */
  core.decodeHtmlEntities = function decodeHtmlEntities(str) {
    let s = String(str ?? "");
    s = s.replace(/&#x([0-9a-f]{1,6});?/gi, (whole, h) => {
      const c = parseInt(h, 16);
      try {
        return Number.isFinite(c) ? String.fromCodePoint(c) : whole;
      } catch {
        return whole;
      }
    });
    s = s.replace(/&#(\d{1,7});?/g, (whole, d) => {
      const c = Number(d);
      try {
        return Number.isFinite(c) ? String.fromCodePoint(c) : whole;
      } catch {
        return whole;
      }
    });
    s = s.replace(/&nbsp;/gi, "\u00a0");
    s = s.replace(/&quot;/gi, '"');
    s = s.replace(/&apos;/gi, "'");
    s = s.replace(/&lt;/gi, "<");
    s = s.replace(/&gt;/gi, ">");
    s = s.replace(/&amp;/gi, "&");
    return s;
  };

  core.fillElementMultilinePlain = function fillElementMultilinePlain(el, text) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    const lines = String(text ?? "").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) el.appendChild(document.createElement("br"));
      el.appendChild(document.createTextNode(lines[i]));
    }
  };

  core.buildTranslateButtonContents = function buildTranslateButtonContents(root) {
    if (!root) return;
    const slot = core.YTDUB_TRANSLATE_SLOT || "main";
    while (root.firstChild) root.removeChild(root.firstChild);
    const iconWrap = document.createElement("span");
    iconWrap.className = "ytdub2-btn-icon";
    iconWrap.setAttribute("aria-hidden", "true");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ytdub2-btn-icon-svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p1.setAttribute("fill", "currentColor");
    p1.setAttribute("fill-opacity", "0.95");
    p1.setAttribute("d", "M4.2 3.75v12.5L11.85 10 4.2 3.75z");
    const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("fill", "none");
    p2.setAttribute("stroke", "currentColor");
    p2.setAttribute("stroke-width", "1.6");
    p2.setAttribute("stroke-linecap", "round");
    p2.setAttribute("d", "M13.15 6.15q2.95 3.85 0 7.7M15.35 3.95q4.25 6.05 0 12.1");
    svg.appendChild(p1);
    svg.appendChild(p2);
    iconWrap.appendChild(svg);
    const label = document.createElement("span");
    label.className = "ytdub2-btn-label";
    label.textContent = "Dịch";
    root.appendChild(iconWrap);
    root.appendChild(label);
    root.setAttribute("data-ytdub-translate-slot", slot);
  };

  /**
   * Tìm nút Dịch trong document hoặc shadow của #movie_player (querySelector document không xuyên shadow).
   */
  core.findConnectedButtonInMoviePlayerTree = function findConnectedButtonInMoviePlayerTree(sel) {
    if (!sel) return null;
    try {
      const light = document.querySelector(sel);
      if (light?.isConnected) return light;
    } catch {
      /* ignore */
    }
    const mp = document.getElementById("movie_player");
    if (!mp) return null;
    const seen = new Set();
    function walk(root) {
      if (!root || seen.has(root)) return null;
      seen.add(root);
      try {
        const hit = root.querySelector?.(sel);
        if (hit?.isConnected) return hit;
      } catch {
        return null;
      }
      if (root.shadowRoot) {
        const h = walk(root.shadowRoot);
        if (h) return h;
      }
      let els;
      try {
        els = root.querySelectorAll("*");
      } catch {
        return null;
      }
      for (let i = 0; i < els.length; i += 1) {
        if (els[i].shadowRoot) {
          const h = walk(els[i].shadowRoot);
          if (h) return h;
        }
      }
      return null;
    }
    return walk(mp);
  };

  /**
   * Gắn lại `__YTDUB_V3.ui.btn` với đúng một nút trong DOM; gỡ trùng. Gọi trước khi đổi disabled/phase.
   */
  core.syncUiTranslateButtonRef = function syncUiTranslateButtonRef() {
    const V = window.__YTDUB_V3;
    const ui = V?.ui;
    if (!ui) return null;
    const slot = core.YTDUB_TRANSLATE_SLOT || "main";
    const slotSel = core.YTDUB_TRANSLATE_BTN_SELECTOR || 'button.ytdub2-btn[data-ytdub-translate-slot="main"]';

    let keep = null;
    if (ui.btn?.isConnected && ui.btn.matches?.("button.ytdub2-btn")) {
      keep = ui.btn;
      keep.setAttribute("data-ytdub-translate-slot", slot);
    } else {
      keep =
        core.findConnectedButtonInMoviePlayerTree(slotSel) ||
        core.findConnectedButtonInMoviePlayerTree("button.ytdub2-btn");
      if (keep) keep.setAttribute("data-ytdub-translate-slot", slot);
      ui.btn = keep;
    }
    if (keep) core.sweepYtdubTranslateButtons(keep);
    else {
      ui.btn = null;
      core.sweepYtdubTranslateButtons(null);
    }
    const ph = V?.state?.phase;
    if (ph === "playing" || ph === "loading" || ph === "translating") {
      try {
        V.repaintTranslateButtonFace?.();
      } catch {
        /* ignore */
      }
    }
    return ui.btn;
  };

  core.buildLoaderOverlayContents = function buildLoaderOverlayContents(root) {
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    const card = document.createElement("div");
    card.className = "ytdub2-loader-card";
    const spinWrap = document.createElement("div");
    spinWrap.className = "ytdub2-loader-spinwrap";
    spinWrap.setAttribute("aria-hidden", "true");
    const spin = document.createElement("div");
    spin.className = "ytdub2-loader-spin";
    spinWrap.appendChild(spin);
    const p = document.createElement("p");
    p.className = "ytdub2-loader-text";
    p.textContent = "Đang tải phụ đề…";
    card.appendChild(spinWrap);
    card.appendChild(p);
    root.appendChild(card);
  };

  core.buildMsgOverlayContents = function buildMsgOverlayContents(root, onOkClick) {
    if (!root) return;
    while (root.firstChild) root.removeChild(root.firstChild);
    const panel = document.createElement("div");
    panel.className = "ytdub2-msg-panel";
    const accent = document.createElement("div");
    accent.className = "ytdub2-msg-accent";
    accent.setAttribute("aria-hidden", "true");
    const main = document.createElement("div");
    main.className = "ytdub2-msg-main";
    const titleEl = document.createElement("p");
    titleEl.className = "ytdub2-msg-title";
    const bodyEl = document.createElement("p");
    bodyEl.className = "ytdub2-msg-body";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "ytdub2-msg-ok";
    ok.textContent = "OK";
    if (typeof onOkClick === "function") ok.addEventListener("click", onOkClick);
    main.appendChild(titleEl);
    main.appendChild(bodyEl);
    main.appendChild(ok);
    panel.appendChild(accent);
    panel.appendChild(main);
    root.appendChild(panel);
  };

  /**
   * Gỡ nút Dịch trùng: `document.querySelectorAll` không thấy nút trong open shadow của player
   * → reinject / build lại để lại 2 nút cạnh nhau. keep != null: giữ đúng node đó.
   */
  core.sweepYtdubTranslateButtons = function sweepYtdubTranslateButtons(keep) {
    const shouldRemove = (n) => keep == null || n !== keep;
    const remInRoot = (root) => {
      if (!root?.querySelectorAll) return;
      try {
        root.querySelectorAll("button.ytdub2-btn").forEach((n) => {
          if (shouldRemove(n)) n.remove();
        });
      } catch {
        /* ignore */
      }
    };
    remInRoot(document);
    const mp = document.getElementById("movie_player");
    if (!mp) return;
    const seen = new Set();
    const walk = (root) => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      remInRoot(root);
      if (root.shadowRoot) walk(root.shadowRoot);
      let els;
      try {
        els = root.querySelectorAll("*");
      } catch {
        return;
      }
      for (let i = 0; i < els.length; i += 1) {
        if (els[i].shadowRoot) walk(els[i].shadowRoot);
      }
    };
    walk(mp);
  };
})();
