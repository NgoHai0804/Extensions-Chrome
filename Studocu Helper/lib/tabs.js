/**
 * Đợi tab load xong
 * @param {number} tabId
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId) {
    return new Promise((resolve) => {
        let resolved = false;
        const done = () => {
            if (resolved) return;
            resolved = true;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        };
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') done();
        };
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId, (tab) => {
            if (!chrome.runtime.lastError && tab?.status === 'complete') done();
        });
    });
}
