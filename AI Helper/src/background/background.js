/* global AIHelperApi, AIHelperStorage, CryptoJS, KJUR, KEYUTIL, hextob64 */

// jsrsasign assumes `window` exists; map it for service worker.
// (ServiceWorkerGlobalScope has `self`, but no `window` identifier.)
var window = self; // eslint-disable-line no-var
var navigator = self.navigator || {}; // eslint-disable-line no-var

importScripts(
  '../vendor/jsrsasign-all-min.js',
  '../vendor/crypto-js.min.js',
  '../common/storage.js',
  '../common/api.js',
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'ASK_AI') {
    handleAskAI(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true; // keep channel open for async
  }

  if (message.type === 'ASK_AI_STREAM') {
    // Streaming: reply via incremental sendResponse callbacks is not supported.
    // Use a Port (chrome.runtime.connect) for streaming updates.
    sendResponse({ ok: false, error: 'STREAMING_USE_PORT' });
    return;
  }

  if (message.type === 'GET_CONVERSATIONS') {
    AIHelperStorage.getConversations()
      .then((convs) => sendResponse({ ok: true, conversations: convs }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'SAVE_CONVERSATIONS') {
    AIHelperStorage.saveConversations(message.payload.conversations || [])
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai_stream') return;

  port.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'ASK_AI_STREAM') return;
    handleAskAIStream(msg.payload, port).catch((e) => {
      try {
        port.postMessage({ type: 'ERROR', error: e.message || String(e) });
      } catch {}
    });
  });
});

async function handleAskAI(payload) {
  const {
    conversationId,
    prompt,
    model,
    mode,
    pageText,
    selectionText,
    pageUrl,
    pageLineCount,
    selectionLineCount,
  } = payload;

  let finalMessage = prompt || '';
  if (mode === 'summarize_page' && pageText) {
    finalMessage = `${pageText}\n\n${prompt || ''}`;
  } else if (mode === 'explain_selection' && selectionText) {
    finalMessage = `${selectionText}\n\n${prompt || ''}`;
  }

  // Ghép lịch sử (để AI trả lời tiếp mạch)
  const conversations = await AIHelperStorage.getConversations();
  let conv = conversations.find((c) => c.id === conversationId);
  const context = buildHistoryContext(conv && conv.messages ? conv.messages : []);
  const messageForAI = context
    ? `${context}\nNgười: ${finalMessage}\nTrợ lý:`
    : finalMessage;

  const aiResult = await AIHelperApi.callAI({
    message: messageForAI,
    conversationId,
    model,
  });

  // Lưu lịch sử hội thoại đơn giản: chỉ lưu text ở đây (có thể mở rộng sau)
  if (!conv) {
    conv = {
      id: conversationId,
      title: (prompt || finalMessage).slice(0, 50) || 'Cuộc hội thoại mới',
      model,
      messages: [],
      createdAt: Date.now(),
    };
    conversations.push(conv);
  }

  // Giống ChatGPT: nếu title vẫn mặc định, lấy từ prompt đầu tiên
  if (
    conv.title === 'Cuộc hội thoại mới' &&
    (!conv.messages || conv.messages.length === 0) &&
    prompt &&
    prompt.trim()
  ) {
    conv.title = prompt.trim().slice(0, 50);
  }

  conv.updatedAt = Date.now();
  conv.messages = conv.messages || [];

  // Lưu lịch sử gọn: chỉ lưu prompt user (không lưu pageText/selectionText dài)
  let userDisplay = prompt || '';
  if (mode === 'summarize_page') {
    const u = pageUrl ? shortUrl(pageUrl) : 'trang hiện tại';
    const lines = typeof pageLineCount === 'number' ? pageLineCount : null;
    userDisplay = `Tóm tắt: ${u}${lines != null ? ` (${lines} dòng)` : ''}${prompt ? `\n${prompt}` : ''}`;
  } else if (mode === 'explain_selection') {
    const u = pageUrl ? shortUrl(pageUrl) : 'trang hiện tại';
    const lines = typeof selectionLineCount === 'number' ? selectionLineCount : null;
    userDisplay = `Giải thích: ${u}${lines != null ? ` (${lines} dòng)` : ''}${prompt ? `\n${prompt}` : ''}`;
  }

  conv.messages.push(
    {
      role: 'user',
      content: userDisplay,
      createdAt: Date.now(),
      meta: {
        mode: mode || 'default',
        pageUrl: pageUrl || null,
        pageLineCount: typeof pageLineCount === 'number' ? pageLineCount : null,
      },
    },
    {
      role: 'assistant',
      content: aiResult.text,
      createdAt: Date.now(),
    },
  );

  await AIHelperStorage.saveConversations(conversations);

  return {
    text: aiResult.text,
    conversationId: conv.id,
  };
}

async function handleAskAIStream(payload, port) {
  const {
    conversationId,
    prompt,
    model,
    mode,
    pageText,
    selectionText,
    pageUrl,
    pageLineCount,
    selectionLineCount,
    streamId,
  } = payload;

  let finalMessage = prompt || '';
  if (mode === 'summarize_page' && pageText) {
    finalMessage = `Tóm tắt nội dung trang web sau:\n\n${pageText}\n\n${prompt || ''}`;
  } else if (mode === 'explain_selection' && selectionText) {
    finalMessage = `Giải thích nội dung đoạn sau:\n\n${selectionText}\n\n${prompt || ''}`;
  }

  const conversations = await AIHelperStorage.getConversations();
  let conv = conversations.find((c) => c.id === conversationId);

  const context = buildHistoryContext(conv && conv.messages ? conv.messages : []);
  const messageForAI = context
    ? `${context}\nNgười: ${finalMessage}\nTrợ lý:`
    : finalMessage;

  let fullText = '';
  let portConnected = true;
  port.onDisconnect.addListener(() => {
    portConnected = false;
  });

  // ensure conversation exists early, and save placeholder assistant message
  if (!conv) {
    conv = {
      id: conversationId,
      title: (prompt || finalMessage).slice(0, 50) || 'Cuộc hội thoại mới',
      model,
      messages: [],
      createdAt: Date.now(),
    };
    conversations.push(conv);
  }

  // Giống ChatGPT: nếu title vẫn mặc định, lấy từ prompt đầu tiên
  if (
    conv.title === 'Cuộc hội thoại mới' &&
    (!conv.messages || conv.messages.length === 0) &&
    prompt &&
    prompt.trim()
  ) {
    conv.title = prompt.trim().slice(0, 50);
  }

  conv.updatedAt = Date.now();
  conv.messages = conv.messages || [];

  let userDisplay = prompt || '';
  if (mode === 'summarize_page') {
    const u = pageUrl ? shortUrl(pageUrl) : 'trang hiện tại';
    const lines = typeof pageLineCount === 'number' ? pageLineCount : null;
    userDisplay = `Tóm tắt: ${u}${lines != null ? ` (${lines} dòng)` : ''}${prompt ? `\n${prompt}` : ''}`;
  } else if (mode === 'explain_selection') {
    const u = pageUrl ? shortUrl(pageUrl) : 'trang hiện tại';
    const lines = typeof selectionLineCount === 'number' ? selectionLineCount : null;
    userDisplay = `Giải thích: ${u}${lines != null ? ` (${lines} dòng)` : ''}${prompt ? `\n${prompt}` : ''}`;
  }

  const assistantMsgId = streamId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const assistantCreatedAt = Date.now();

  conv.messages.push(
    {
      role: 'user',
      content: userDisplay,
      createdAt: Date.now(),
      meta: {
        mode: mode || 'default',
        pageUrl: pageUrl || null,
        pageLineCount: typeof pageLineCount === 'number' ? pageLineCount : null,
      },
    },
    {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: assistantCreatedAt,
      meta: { streaming: true },
    },
  );

  await AIHelperStorage.saveConversations(conversations);

  safePost(port, portConnected, { type: 'START' });

  // save partial every ~1s
  let lastSaveAt = Date.now();

  const result = await AIHelperApi.callAIStream({
    message: messageForAI,
    conversationId,
    model,
    onDelta: (delta, accumulated) => {
      fullText = accumulated;
      safePost(port, portConnected, { type: 'DELTA', delta });

      const now = Date.now();
      if (now - lastSaveAt > 1000) {
        lastSaveAt = now;
        updateAssistantStreamingMessage(conversations, conversationId, assistantMsgId, fullText, true);
        AIHelperStorage.saveConversations(conversations).catch(() => {});
      }
    },
  });

  fullText = result.text || fullText;

  // finalize: update the placeholder assistant message instead of pushing a new one
  updateAssistantStreamingMessage(conversations, conversationId, assistantMsgId, fullText, false);
  conv.updatedAt = Date.now();

  await AIHelperStorage.saveConversations(conversations);

  safePost(port, portConnected, { type: 'DONE', text: fullText, conversationId: conv.id });
}

function safePost(port, isConnected, message) {
  if (!isConnected) return;
  try {
    port.postMessage(message);
  } catch {
    // ignore if popup closed / port disconnected mid-stream
  }
}

function updateAssistantStreamingMessage(conversations, conversationId, assistantMsgId, content, streaming) {
  const conv = (conversations || []).find((c) => c.id === conversationId);
  if (!conv || !conv.messages) return;
  const msg = conv.messages.find((m) => m && m.id === assistantMsgId);
  if (!msg) return;
  msg.content = content;
  msg.meta = msg.meta || {};
  msg.meta.streaming = streaming;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const hostFull = u.host || '';
    const host = hostFull.length > 18 ? `…${hostFull.slice(-18)}` : hostFull;
    const path = u.pathname || '';

    const parts = path.split('/').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : '';
    const head = parts.length ? parts[0] : '';
    const shortLast = last.length > 10 ? `${last.slice(0, 8)}…${last.slice(-3)}` : last;

    const composed = last
      ? `${host}/${head ? `${head}/` : ''}${shortLast}`
      : host;

    if (composed.length <= 32) return composed;
    return `${composed.slice(0, 14)}…${composed.slice(-14)}…`;
  } catch {
    return truncateUrl(url, 32);
  }
}

function truncateUrl(url, maxLen = 60) {
  const s = String(url || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function buildHistoryContext(messages) {
  // Lấy vài turn gần nhất để tránh quá dài
  const maxMessages = 8; // user/assistant xen kẽ
  const recent = (messages || []).slice(-maxMessages);
  let out = '';

  for (const msg of recent) {
    if (!msg || !msg.role || !msg.content) continue;
    const content = String(msg.content).trim();
    if (!content) continue;

    if (msg.role === 'user') {
      out += `Người: ${content}\n`;
    } else if (msg.role === 'assistant') {
      out += `Trợ lý: ${content}\n`;
    }
  }

  return out.trim();
}

