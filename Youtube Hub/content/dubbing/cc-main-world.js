/**
 * MAIN world (youtube.com): đọc data-yt-ext-cc-lang, bật nút CC nếu đang tắt,
 * rồi setOption / textTracks. Tên ATTR phải khớp `cc-constants.js` (__YTDUB_CC).
 */
(function () {
  if (globalThis.__YT_EXT_CC_PAGE__) return;
  globalThis.__YT_EXT_CC_PAGE__ = true;

  const ATTR = "data-yt-ext-cc-lang";
  const ACTION_ATTR = "data-yt-ext-action";

  function readLang() {
    const v = document.documentElement.getAttribute(ATTR);
    return v && String(v).trim() ? String(v).trim() : "";
  }

  function resolvePlayer() {
    const movie = document.getElementById("movie_player");
    if (movie) {
      if (typeof movie.setOption === "function") return movie;
      if (typeof movie.getPlayer === "function") {
        try {
          const p = movie.getPlayer();
          if (p && typeof p.setOption === "function") return p;
        } catch (_) {}
      }
    }
    const host =
      document.querySelector("ytd-watch-flexy ytd-player") ||
      document.querySelector("ytd-player#ytd-player") ||
      document.querySelector("ytd-player");
    if (host && typeof host.getPlayer === "function") {
      try {
        const p = host.getPlayer();
        if (p && typeof p.setOption === "function") return p;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Nút CC thực tế: .ytp-right-controls > button.ytp-subtitles-button.ytp-button
   * (aria-pressed="false" khi đang tắt).
   */
  function querySubtitlesButton(root) {
    if (!root || !root.querySelector) return null;
    const sels = [
      ".ytp-right-controls button.ytp-subtitles-button.ytp-button",
      ".ytp-right-controls button.ytp-subtitles-button",
      "button.ytp-subtitles-button.ytp-button",
      "button.ytp-subtitles-button"
    ];
    for (let i = 0; i < sels.length; i++) {
      try {
        const el = root.querySelector(sels[i]);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function findSubtitlesButton() {
    const hosts = [document.getElementById("movie_player"), document.querySelector(".html5-video-player")];
    for (let h = 0; h < hosts.length; h++) {
      const host = hosts[h];
      if (!host) continue;
      let hit = querySubtitlesButton(host);
      if (hit) return hit;
      const sr = host.shadowRoot;
      if (sr) {
        hit = querySubtitlesButton(sr);
        if (hit) return hit;
      }
    }
    return querySubtitlesButton(document) || document.querySelector(".ytp-subtitles-button");
  }

  /** Bật phụ đề bằng UI player (chỉ khi aria-pressed="false"). */
  function pressCcButtonIfNeeded() {
    const btn = findSubtitlesButton();
    if (!btn || typeof btn.click !== "function") return;
    const pressed = btn.getAttribute("aria-pressed");
    if (pressed !== "false") return;
    btn.click();
  }

  function applyTextTracks(langFull) {
    const want = String(langFull || "").toLowerCase();
    const base = want.split(/[-_]/)[0];
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      const tracks = video.textTracks;
      if (!tracks || !tracks.length) continue;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t.kind !== "subtitles" && t.kind !== "captions") continue;
        const tl = (t.language || "").toLowerCase();
        const tb = tl.split(/[-_]/)[0];
        if (tl === want || tb === base) t.mode = "showing";
        else t.mode = "disabled";
      }
    }
  }

  function applySetOption(langCode) {
    const player = resolvePlayer();
    if (!player) return false;
    const code = String(langCode || "en").replace(/[^\w-]/g, "") || "en";
    try {
      if (typeof player.loadModule === "function") player.loadModule("captions");
    } catch (_) {}
    try {
      player.setOption("captions", "track", { languageCode: code });
    } catch (_) {}
    try {
      player.setOption("cc", "track", { languageCode: code });
    } catch (_) {}
    return true;
  }

  function apply() {
    const lang = readLang();
    if (!lang) return;
    pressCcButtonIfNeeded();
    applySetOption(lang);
    applyTextTracks(lang);
  }

  function schedule() {
    clearTimeout(schedule._t);
    schedule._t = setTimeout(apply, 100);
  }

  function findSettingsButton() {
    return (
      document.querySelector("#movie_player button.ytp-settings-button") ||
      document.querySelector(".html5-video-player button.ytp-settings-button") ||
      document.querySelector("button.ytp-settings-button")
    );
  }

  function isSubtitlesMenuItem(el) {
    if (!el || !el.closest) return false;
    const label = el.querySelector(".ytp-menuitem-label");
    const raw =
      ((label && label.textContent) || el.textContent || "") + " " + (el.getAttribute("aria-label") || "");
    const s = raw.toLowerCase();
    return /subtitle|caption|phụ đề|subtitles|cc\b|字幕|untertitel|sous-titres|subtítulos|legendas/.test(s);
  }

  function querySubtitleMenuItems() {
    const roots = [
      document.querySelector("#movie_player .ytp-popup"),
      document.querySelector(".ytp-popup"),
      document.querySelector(".ytp-settings-menu"),
      document.querySelector(".ytp-panel-menu"),
      document.querySelector(".ytp-panel.ytp-panel-menu")
    ];
    const out = [];
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      if (!r) continue;
      try {
        r.querySelectorAll(".ytp-menuitem").forEach((el) => {
          if (isSubtitlesMenuItem(el)) out.push(el);
        });
      } catch (_) {}
    }
    return out;
  }

  function clickSubtitlesInSettingsMenu() {
    const items = querySubtitleMenuItems();
    for (let i = 0; i < items.length; i++) {
      try {
        items[i].click();
        return true;
      } catch (_) {}
    }
    return false;
  }

  function queryAllYtpMenuItems() {
    const roots = document.querySelectorAll(
      "#movie_player .ytp-popup, .ytp-popup, .ytp-settings-menu, .ytp-panel-menu, .ytp-panel"
    );
    const out = [];
    for (let i = 0; i < roots.length; i++) {
      try {
        roots[i].querySelectorAll(".ytp-menuitem").forEach((el) => {
          out.push(el);
        });
      } catch (_) {}
    }
    return out;
  }

  function isAutoTranslateItem(el) {
    const raw = (el.textContent || "") + " " + (el.getAttribute("aria-label") || "");
    const s = raw.toLowerCase().trim();
    return /auto[-\s]?translate|automatic translation|machine translation|tự động dịch|dịch tự động|traduction automat|traduction auto|traducción automática|自動翻訳|자동 번역|machine/.test(
      s
    );
  }

  function langMatchers(ytCode) {
    const c = String(ytCode || "en").toLowerCase();
    const common = [
      [/^(vietnamese|tiếng việt)\b/i, /\bvietnamese\b/i, /\btiếng việt\b/i],
      [/^(english|tiếng anh)\b/i, /\benglish\b/i, /\benglish \(united states\)/i],
      [/japanese|日本|tiếng nhật|にほんご|日本語/i],
      [/korean|한국|tiếng hàn|한국어/i],
      [/chinese \(simplified\)|简体中文|简体|giản thể|chinese.*simplified/i],
      [/chinese \(traditional\)|繁體|繁體中文|phồn thể|chinese.*traditional/i],
      [/thai|ไทย|tiếng thái/i],
      [/indonesian|indonesia|bahasa indonesia|tiếng indonesia/i],
      [/french|français|tiếng pháp/i],
      [/german|deutsch|tiếng đức/i],
      [/spanish|español|castellano|tiếng tây ban nha/i],
      [/hebrew|עברית|tiếng do thái/i],
      [/turkish|türkçe|tiếng thổ/i],
      [/italian|italiano|tiếng ý/i],
      [/portuguese|português|portugues|tiếng bồ đào nha/i],
      [/russian|русский|tiếng nga/i],
      [/arabic|العربية|tiếng ả rập/i],
      [/hindi|हिन्दी|हिंदी|tiếng hindi/i],
      [/dutch|nederlands|tiếng hà lan/i],
      [/polish|polski|tiếng ba lan/i],
      [/ukrainian|українська|tiếng ukraina/i],
      [/swedish|svenska|tiếng thụy điển/i],
      [/danish|dansk|tiếng đan mạch/i],
      [/finnish|suomi|tiếng phần lan/i],
      [/norwegian|norsk|tiếng na uy/i],
      [/czech|čeština|cesky|tiếng séc/i],
      [/greek|ελληνικά|tiếng hy lạp/i],
      [/hungarian|magyar|tiếng hungary/i],
      [/romanian|română|tiếng rumani/i],
      [/persian|farsi|فارسی|tiếng ba tư/i],
      [/bengali|বাংলা|bangla/i],
      [/filipino|tagalog|tiếng philippin/i],
      [/malay|bahasa melayu|melayu|tiếng mã lai/i]
    ];
    const byCode = {
      vi: common[0],
      en: common[1],
      ja: common[2],
      ko: common[3],
      "zh-hans": common[4],
      "zh-hant": common[5],
      th: common[6],
      id: common[7],
      fr: common[8],
      de: common[9],
      es: common[10],
      he: common[11],
      tr: common[12],
      it: common[13],
      pt: common[14],
      ru: common[15],
      ar: common[16],
      hi: common[17],
      nl: common[18],
      pl: common[19],
      uk: common[20],
      sv: common[21],
      da: common[22],
      fi: common[23],
      no: common[24],
      cs: common[25],
      el: common[26],
      hu: common[27],
      ro: common[28],
      fa: common[29],
      bn: common[30],
      tl: common[31],
      ms: common[32]
    };
    if (byCode[c]) return byCode[c];
    const safe = c.replace(/[^\w-]/g, "");
    return [new RegExp("\\b" + safe.replace(/-/g, "[-\\s]*") + "\\b", "i")];
  }

  function clickAutoTranslateMenuItem() {
    const items = queryAllYtpMenuItems();
    for (let i = 0; i < items.length; i++) {
      if (!isAutoTranslateItem(items[i])) continue;
      try {
        items[i].click();
        return true;
      } catch (_) {}
    }
    return false;
  }

  function clickTargetLanguageMenuItem(ytCode) {
    if (!ytCode) return false;
    const patterns = langMatchers(ytCode);
    const items = queryAllYtpMenuItems();
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      if (isAutoTranslateItem(el)) continue;
      if (isSubtitlesMenuItem(el)) continue;
      const raw = (el.textContent || "") + " " + (el.getAttribute("aria-label") || "");
      if (/^(quality|playback|speed|chất lượng|tốc độ|loop|ambient|ổn định)/i.test(raw.trim())) {
        continue;
      }
      for (let p = 0; p < patterns.length; p++) {
        try {
          if (patterns[p].test(raw)) {
            el.click();
            return true;
          }
        } catch (_) {}
      }
    }
    return false;
  }

  function openSettingsThenSubtitlesAndTranslate() {
    const targetLang = readLang();
    const settingsBtn = findSettingsButton();
    if (settingsBtn && settingsBtn.getAttribute("aria-expanded") !== "true") {
      try {
        settingsBtn.click();
      } catch (_) {}
    }

    let gotSubtitles = false;
    let gotAuto = false;
    let gotLang = false;

    const times = [
      80, 180, 320, 500, 750, 1000, 1400, 1900, 2600, 3400, 4200, 5200, 6500, 8000, 9500, 11000
    ];
    for (let i = 0; i < times.length; i++) {
      setTimeout(() => {
        if (!gotSubtitles) {
          gotSubtitles = clickSubtitlesInSettingsMenu();
        }
        if (gotSubtitles && !gotAuto) {
          gotAuto = clickAutoTranslateMenuItem();
        }
        if (gotSubtitles && targetLang && !gotLang) {
          if (gotAuto || times[i] >= 3200) {
            gotLang = clickTargetLanguageMenuItem(targetLang);
          }
        }
      }, times[i]);
    }
  }

  function readAction() {
    return document.documentElement.getAttribute(ACTION_ATTR);
  }

  function consumeActionIfAny() {
    const v = readAction();
    if (v !== "open-cc-settings") return;
    try {
      document.documentElement.removeAttribute(ACTION_ATTR);
    } catch (_) {}
    openSettingsThenSubtitlesAndTranslate();
  }

  window.addEventListener("yt-navigate-finish", schedule);
  window.addEventListener("yt-page-data-updated", schedule);

  try {
    new MutationObserver(() => {
      schedule();
      consumeActionIfAny();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: [ATTR, ACTION_ATTR]
    });
  } catch (_) {}

  const applyDelays = [0, 400, 1200, 2500];
  for (let i = 0; i < applyDelays.length; i++) {
    setTimeout(schedule, applyDelays[i]);
  }

  setTimeout(consumeActionIfAny, 0);
})();
