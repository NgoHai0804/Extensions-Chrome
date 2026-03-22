chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'GET_PAGE_CONTEXT') {
    const selection = window.getSelection();
    const selectionText = selection ? selection.toString() : '';
    const pageText = document.body ? document.body.innerText || '' : '';

    sendResponse({
      ok: true,
      pageText,
      selectionText,
    });
    return true;
  }
});

