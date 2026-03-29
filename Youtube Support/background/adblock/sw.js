/**
 * Chặn quảng cáo YouTube: DNR (mạng). Patch MAIN (fetch/XHR) do content script
 * `adblock-bootstrap.js` inject sớm — không phụ thuộc SW.
 */
import { STORAGE_KEY, mergeExtensionSettings } from "../../content/dubbing/core/extension-settings-esm.js";

const YT_INITIATORS = ["youtube.com", "www.youtube.com", "m.youtube.com"];
const RULE_ID_START = 994500;
const RULE_ID_END = 994511;

function buildDynamicRules() {
  return [
    {
      id: 994500,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/pagead/",
        resourceTypes: ["xmlhttprequest", "sub_frame", "script", "image"]
      }
    },
    {
      id: 994501,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/youtubei/v1/player/ad_break",
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994502,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||www.youtube.com/get_midroll_",
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994503,
      priority: 2000,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||m.youtube.com/get_midroll_",
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994504,
      priority: 1900,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "adunit",
        requestDomains: ["youtube.com", "www.youtube.com", "m.youtube.com"],
        resourceTypes: ["xmlhttprequest"]
      }
    },
    {
      id: 994505,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/api/stats/ads?",
        resourceTypes: ["xmlhttprequest", "ping", "image"]
      }
    },
    {
      id: 994506,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||youtube.com/pcs/activeview?",
        resourceTypes: ["xmlhttprequest", "ping", "image"]
      }
    },
    {
      id: 994507,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||ad.doubleclick.net/",
        resourceTypes: ["xmlhttprequest", "ping", "image"]
      }
    },
    {
      id: 994508,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||googleads.g.doubleclick.net/pagead/",
        resourceTypes: ["xmlhttprequest", "script", "sub_frame", "image", "ping"]
      }
    },
    {
      id: 994509,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||doubleclick.com/",
        resourceTypes: ["xmlhttprequest", "image", "ping"]
      }
    },
    {
      id: 994510,
      priority: 1800,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        urlFilter: "||google.com/pagead/",
        resourceTypes: ["xmlhttprequest", "image", "ping"]
      }
    },
    {
      id: 994511,
      priority: 1750,
      action: { type: "block" },
      condition: {
        initiatorDomains: YT_INITIATORS,
        regexFilter: "^https?:\\/\\/[^/]*youtube\\.com\\/get_video_info\\?.*([?&])adformat=",
        resourceTypes: ["xmlhttprequest"]
      }
    }
  ];
}

async function updateOurRules(addRules) {
  const all = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = all.filter((r) => r.id >= RULE_ID_START && r.id <= RULE_ID_END).map((r) => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function removeAdblockRules() {
  await updateOurRules([]);
}

async function applyAdblockRules() {
  await updateOurRules(buildDynamicRules());
}

async function adblockEnabledFromStorage() {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    return mergeExtensionSettings(r[STORAGE_KEY]).adblockEnabled !== false;
  } catch {
    return true;
  }
}

async function refreshYoutubeAdblock() {
  const on = await adblockEnabledFromStorage();
  try {
    if (on) await applyAdblockRules();
    else await removeAdblockRules();
  } catch (e) {
    console.warn("[YTHUB][adblock] refresh failed", e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshYoutubeAdblock();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshYoutubeAdblock();
});

/**
 * Phát hiện đổi chặn QC: so khóa `adblockEnabled` trên object thô (tránh bỏ sót khi trước/sau merge cùng `true`
 * nhưng lần đầu mới ghi key — khi đó DNR chưa bật).
 */
function storageAdblockEffectivelyChanged(oldRaw, newRaw) {
  const o = oldRaw && typeof oldRaw === "object" ? oldRaw : {};
  const n = newRaw && typeof newRaw === "object" ? newRaw : {};
  const oHas = Object.prototype.hasOwnProperty.call(o, "adblockEnabled");
  const nHas = Object.prototype.hasOwnProperty.call(n, "adblockEnabled");
  if (oHas !== nHas) return true;
  if (oHas && nHas && o.adblockEnabled !== n.adblockEnabled) return true;
  const e1 = mergeExtensionSettings(o).adblockEnabled;
  const e2 = mergeExtensionSettings(n).adblockEnabled;
  return e1 !== e2;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  if (!storageAdblockEffectivelyChanged(changes[STORAGE_KEY].oldValue, changes[STORAGE_KEY].newValue)) {
    return;
  }
  void refreshYoutubeAdblock();
});

const MSG_REFRESH_ADBLOCK = "YTHUB_REFRESH_ADBLOCK";
const MSG_SET_MAIN_ADBLOCK_FLAG = "YTHUB_SET_MAIN_ADBLOCK_FLAG";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === MSG_SET_MAIN_ADBLOCK_FLAG) {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false });
      return false;
    }
    const enabled = Boolean(msg.enabled);
    void chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        injectImmediately: true,
        func: (v) => {
          try {
            window.__ythubAdblockUserWant = v;
          } catch {
            /* ignore */
          }
        },
        args: [enabled]
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type !== MSG_REFRESH_ADBLOCK) return false;
  void refreshYoutubeAdblock().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
  return true;
});

void refreshYoutubeAdblock();
