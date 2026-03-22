/**
 * Ad Blocker Lite - Background service worker
 * Bật/tắt các ruleset chặn quảng cáo qua chrome.declarativeNetRequest
 */

const RULESET_IDS = [
  'ublock-filters',
  'easylist',
  'easyprivacy',
  'pgl',
  'ublock-badware',
  'urlhaus-full',
];

const STORAGE_KEY = 'adblockEnabled';
const BLOCKED_TOTAL_KEY = 'blockedTotal';

let isEnabled = true;
let blockedTotal = 0;
let pendingFlush = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(STORAGE_KEY, (data) => {
    const enabled = data[STORAGE_KEY] !== false;
    isEnabled = enabled;
    chrome.storage.local.set({ [STORAGE_KEY]: enabled }, () => {
      setRulesetsEnabled(enabled);
    });
  });
});

// Warm up state on service worker start
chrome.storage.local.get([STORAGE_KEY, BLOCKED_TOTAL_KEY], (data) => {
  isEnabled = data[STORAGE_KEY] !== false;
  blockedTotal = Number(data[BLOCKED_TOTAL_KEY]) || 0;
});

async function setRulesetsEnabled(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: RULESET_IDS,
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: RULESET_IDS,
      });
    }
  } catch (e) {
    console.error('Ad Blocker Lite:', e);
  }
}

function scheduleFlush() {
  if (pendingFlush) return;
  pendingFlush = true;
  setTimeout(() => {
    pendingFlush = false;
    chrome.storage.local.set({ [BLOCKED_TOTAL_KEY]: blockedTotal });
  }, 1000);
}

// Count matched rules (debug feedback; requires declarativeNetRequestFeedback)
if (chrome.declarativeNetRequest?.onRuleMatchedDebug?.addListener) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(() => {
    if (!isEnabled) return;
    blockedTotal += 1;
    scheduleFlush();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'getEnabled') {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      sendResponse({ enabled: data[STORAGE_KEY] !== false });
    });
    return true;
  }
  if (msg.type === 'setEnabled') {
    const enabled = !!msg.enabled;
    chrome.storage.local.set({ [STORAGE_KEY]: enabled }, () => {
      const wasEnabled = isEnabled;
      isEnabled = enabled;
      if (enabled === true && wasEnabled === false) {
        blockedTotal = 0;
        chrome.storage.local.set({ [BLOCKED_TOTAL_KEY]: 0 });
      }
      setRulesetsEnabled(enabled)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
    });
    return true;
  }
  if (msg.type === 'getStats') {
    chrome.storage.local.get(BLOCKED_TOTAL_KEY, (data) => {
      sendResponse({ blockedTotal: Number(data[BLOCKED_TOTAL_KEY]) || 0 });
    });
    return true;
  }
  if (msg.type === 'resetStats') {
    blockedTotal = 0;
    chrome.storage.local.set({ [BLOCKED_TOTAL_KEY]: 0 }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});
