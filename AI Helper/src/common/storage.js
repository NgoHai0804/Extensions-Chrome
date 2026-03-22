// Helper lưu đọc dữ liệu từ chrome.storage (classic script for service worker importScripts)

(function initStorage(global) {
  const STORAGE_KEYS = {
    SETTINGS: 'ai_helper_settings',
    CONVERSATIONS: 'ai_helper_conversations',
  };

  async function getSettings() {
    const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
    return (
      result[STORAGE_KEYS.SETTINGS] || {
        apiUrl: 'https://extensiondock.com/chatgpt/v3/question',
        defaultModel: 'gpt-4o-mini',
      }
    );
  }

  async function saveSettings(settings) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SETTINGS]: settings,
    });
  }

  async function getConversations() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONVERSATIONS);
    return result[STORAGE_KEYS.CONVERSATIONS] || [];
  }

  async function saveConversations(conversations) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.CONVERSATIONS]: conversations,
    });
  }

  global.AIHelperStorage = {
    getSettings,
    saveSettings,
    getConversations,
    saveConversations,
  };
})(self);

