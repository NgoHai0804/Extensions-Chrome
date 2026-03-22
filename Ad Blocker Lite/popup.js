(function () {
  const statusEl = document.getElementById('status');
  const enabledSwitchEl = document.getElementById('enabledSwitch');
  const blockedTotalEl = document.getElementById('blockedTotal');
  const resetEl = document.getElementById('reset');
  let lastEnabled = undefined;

  function setUI(enabled) {
    statusEl.textContent = enabled ? 'Đang bật' : 'Đang tắt';
    statusEl.classList.toggle('on', enabled);
    statusEl.classList.toggle('off', !enabled);
    enabledSwitchEl.checked = enabled;
    lastEnabled = enabled;
  }

  function refreshStats() {
    chrome.runtime.sendMessage({ type: 'getStats' }, (res) => {
      const n = res && typeof res.blockedTotal === 'number' ? res.blockedTotal : 0;
      blockedTotalEl.textContent = String(n);
    });
  }

  chrome.runtime.sendMessage({ type: 'getEnabled' }, (res) => {
    const enabled = res && res.enabled !== false;
    setUI(enabled);
    refreshStats();
  });

  enabledSwitchEl.addEventListener('change', () => {
    const next = !!enabledSwitchEl.checked;
    setUI(next);
    if (next === true && lastEnabled === false) {
      chrome.runtime.sendMessage({ type: 'resetStats' }, () => {
        blockedTotalEl.textContent = '0';
        chrome.runtime.sendMessage({ type: 'setEnabled', enabled: next }, () => {});
      });
      return;
    }
    chrome.runtime.sendMessage({ type: 'setEnabled', enabled: next }, () => {});
  });

  resetEl.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'resetStats' }, () => {
      blockedTotalEl.textContent = '0';
    });
  });

  // Keep the counter fresh while popup is open
  setInterval(refreshStats, 1000);
})();
