import { getSettings, saveSettings } from '../common/storage.js';

const els = {
  apiUrl: document.getElementById('api-url'),
  language: document.getElementById('language'),
  defaultModel: document.getElementById('default-model'),
  saveBtn: document.getElementById('save-btn'),
  status: document.getElementById('status'),
};

async function init() {
  const settings = await getSettings();
  els.apiUrl.value = settings.apiUrl || '';
  els.language.value = settings.language || 'vi';
  els.defaultModel.value = settings.defaultModel || 'gpt-4o-mini';
}

els.saveBtn.addEventListener('click', async () => {
  const settings = {
    apiUrl: els.apiUrl.value.trim(),
    language: els.language.value.trim() || 'vi',
    defaultModel: els.defaultModel.value.trim() || 'gpt-4o-mini',
  };

  await saveSettings(settings);
  els.status.textContent = 'Đã lưu!';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
});

init();

