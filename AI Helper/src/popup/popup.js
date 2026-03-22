function createConversationId() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let currentConversationId = createConversationId();
let conversations = [];

const els = {
  bodyContainer: document.getElementById('body-container'),
  main: document.querySelector('.main'),
  messages: document.getElementById('messages'),
  promptInput: document.getElementById('prompt-input'),
  sendBtn: document.getElementById('send-btn'),
  modelSelect: document.getElementById('model-select'),
  modeSelect: document.getElementById('mode-select'),
  contextHint: document.getElementById('context-hint'),
  convList: document.getElementById('conversation-list'),
  newConvBtn: document.getElementById('new-conv-btn'),
  newConvBtnTop: document.getElementById('new-conv-btn-top'),
  renameConvBtn: document.getElementById('rename-conv-btn'),
  deleteConvBtn: document.getElementById('delete-conv-btn'),
  toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
};

els.sendBtn.addEventListener('click', () => {
  sendPrompt();
});

els.promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});

if (els.newConvBtn) {
  els.newConvBtn.addEventListener('click', () => {
    createNewConversation();
  });
}

els.newConvBtnTop.addEventListener('click', () => {
  createNewConversation();
});

els.renameConvBtn.addEventListener('click', () => {
  renameCurrentConversation();
});

els.deleteConvBtn.addEventListener('click', () => {
  deleteCurrentConversation();
});

els.toggleSidebarBtn.addEventListener('click', () => {
  els.bodyContainer.classList.toggle('collapsed');
});

els.modeSelect.addEventListener('change', () => {
  refreshContextHint();
});

async function init() {
  // Lấy danh sách hội thoại từ background
  chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' }, (response) => {
    if (response && response.ok) {
      conversations = (response.conversations || []).slice();
      // sắp xếp theo thời gian tạo: sớm nhất -> muộn nhất
      conversations.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (conversations.length > 0) {
        currentConversationId = conversations[0].id;
      } else {
        createNewConversation(false);
      }
      renderConversationList();
      renderCurrentConversationMessages();
      refreshContextHint();
    } else {
      createNewConversation(false);
      renderConversationList();
      refreshContextHint();
    }
  });
}

function createNewConversation(selectAfterCreate = true) {
  const id = createConversationId();
  const conv = {
    id,
    title: 'Cuộc trò chuyện mới',
    model: els.modelSelect.value,
    messages: [],
    createdAt: Date.now(),
  };
  conversations.push(conv); // thêm vào cuối để giữ thứ tự thời gian
  if (selectAfterCreate) {
    currentConversationId = id;
    clearMessages();
    renderCurrentConversationMessages();
    saveConversations();
  }
  renderConversationList();
}

function renameCurrentConversation() {
  const conv = conversations.find((c) => c.id === currentConversationId);
  if (!conv) return;
  const newTitle = prompt('Nhập tên mới cho cuộc trò chuyện:', conv.title || '');
  if (!newTitle) return;
  conv.title = newTitle;
  renderConversationList();
  saveConversations();
}

function deleteCurrentConversation() {
  if (!currentConversationId) return;
  if (!confirm('Xóa cuộc trò chuyện hiện tại?')) return;
  conversations = conversations.filter((c) => c.id !== currentConversationId);
  if (conversations.length > 0) {
    currentConversationId = conversations[0].id;
  } else {
    createNewConversation(false);
    currentConversationId = conversations[0].id;
  }
  renderConversationList();
  renderCurrentConversationMessages();
  saveConversations();
}

function renderConversationList() {
  els.convList.innerHTML = '';
  conversations.forEach((conv) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'conv-title';
    title.textContent = conv.title || 'Không tiêu đề';
    const time = document.createElement('div');
    time.className = 'conv-time';
    time.textContent = formatTime(conv.updatedAt || conv.createdAt);
    li.appendChild(title);
    li.appendChild(time);
    if (conv.id === currentConversationId) {
      li.classList.add('active');
    }
    li.addEventListener('click', () => {
      currentConversationId = conv.id;
      renderConversationList();
      renderCurrentConversationMessages();
    });
    els.convList.appendChild(li);
  });
}

function renderCurrentConversationMessages() {
  clearMessages();
  const conv = conversations.find((c) => c.id === currentConversationId);
  if (!conv || !conv.messages) return;
  conv.messages.forEach((msg) => {
    const text = msg.role === 'user' ? truncate(msg.content, 400) : msg.content;
    appendMessage(msg.role, text, msg.createdAt);
  });
  scrollToBottom();
}

function clearMessages() {
  els.messages.innerHTML = '';
}

async function sendPrompt() {
  const prompt = els.promptInput.value.trim();
  if (!prompt) return;

  const mode = els.modeSelect.value;
  const model = els.modelSelect.value;

  appendMessage('user', prompt, Date.now());
  els.promptInput.value = '';

  let pageText = null;
  let selectionText = null;
  let pageUrl = null;
  let pageLineCount = null;
  let selectionLineCount = null;

  if (mode === 'summarize_page' || mode === 'explain_selection') {
    // Lấy thông tin từ tab hiện tại thông qua content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null && /^https?:/i.test(tab.url || '')) {
      pageUrl = tab.url || null;
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_PAGE_CONTEXT',
        });
        if (result && result.ok) {
          pageText = result.pageText;
          selectionText = result.selectionText;
          if (pageText) {
            pageLineCount = countLines(pageText);
          }
          if (selectionText) {
            selectionLineCount = countLines(selectionText);
          }
        }
      } catch (e) {
        // Không thể lấy context (ví dụ: tab đặc biệt hoặc content script chưa inject) → bỏ qua context
        console.warn('Không thể lấy context trang:', e);
      }
    }
  }

  const streamId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const placeholder = appendStreamingPlaceholder(streamId, Date.now());

  const port = chrome.runtime.connect({ name: 'ai_stream' });
  let accumulated = '';

  port.onMessage.addListener((m) => {
    if (!m) return;
    if (m.type === 'DELTA') {
      accumulated += m.delta || '';
      updateStreamingMessage(placeholder, accumulated);
      return;
    }
    if (m.type === 'DONE') {
      port.disconnect();
      // refresh conversations from background (already saved)
      chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' }, (resp2) => {
        if (resp2 && resp2.ok) {
          conversations = resp2.conversations || conversations;
          renderConversationList();
          renderCurrentConversationMessages();
          refreshContextHint();
        }
      });
      return;
    }
    if (m.type === 'ERROR') {
      port.disconnect();
      removeStreamingPlaceholder(placeholder);
      appendMessage('assistant', `Lỗi: ${m.error || 'Không rõ'}`, Date.now());
    }
  });

  port.postMessage({
    type: 'ASK_AI_STREAM',
    payload: {
      conversationId: currentConversationId,
      prompt,
      model,
      mode,
      pageText,
      selectionText,
      pageUrl,
      pageLineCount,
      selectionLineCount,
      streamId,
    },
  });
}

function appendMessage(role, text, createdAt, isPlaceholder = false) {
  const wrap = document.createElement('div');
  wrap.className = `message-wrap ${role}`;
  if (isPlaceholder) {
    wrap.dataset.placeholder = 'true';
  }

  const bubble = document.createElement('div');
  bubble.className = `message ${role}`;
  if (isPlaceholder) {
    bubble.classList.add('thinking');
    bubble.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  } else {
    bubble.innerHTML = renderMarkdown(text);
    typesetMath(bubble);
  }

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatTime(createdAt);

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  els.messages.appendChild(wrap);
  scrollToBottom();
}

function appendStreamingPlaceholder(streamId, createdAt) {
  const wrap = document.createElement('div');
  wrap.className = 'message-wrap assistant';
  wrap.dataset.placeholder = 'true';
  wrap.dataset.streamId = streamId;

  const bubble = document.createElement('div');
  bubble.className = 'message assistant thinking';
  bubble.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = formatTime(createdAt);

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  els.messages.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function updateStreamingMessage(placeholderWrap, fullText) {
  const bubble = placeholderWrap.querySelector('.message.assistant');
  if (!bubble) return;
  bubble.classList.remove('thinking');
  // Perf mode while streaming: update plain text only.
  // Full markdown/math render happens once after DONE via history re-render.
  bubble.textContent = fullText;
  scrollToBottom();
}

function removeStreamingPlaceholder(placeholderWrap) {
  if (placeholderWrap && placeholderWrap.remove) placeholderWrap.remove();
}

function scrollToBottom() {
  // `.main` là container có overflow-y
  if (!els.main) return;
  els.main.scrollTop = els.main.scrollHeight;
}

function removeThinkingPlaceholder() {
  const nodes = els.messages.querySelectorAll('[data-placeholder="true"]');
  nodes.forEach((n) => n.remove());
}

async function refreshContextHint() {
  const mode = els.modeSelect.value;
  if (mode !== 'summarize_page' && mode !== 'explain_selection') {
    els.contextHint.textContent = '';
    els.contextHint.classList.remove('show');
    els.contextHint.classList.remove('multiline');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null || !/^https?:/i.test(tab.url || '')) {
    els.contextHint.textContent = mode === 'summarize_page'
      ? 'Tóm tắt trang: không hỗ trợ tab hiện tại.'
      : 'Giải thích đoạn chọn: không hỗ trợ tab hiện tại.';
    els.contextHint.classList.add('show');
    els.contextHint.classList.remove('multiline');
    return;
  }

  let pageText = '';
  let selectionText = '';
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' });
    if (result && result.ok) {
      if (result.pageText) pageText = result.pageText;
      if (result.selectionText) selectionText = result.selectionText;
    }
  } catch (e) {
    els.contextHint.textContent = mode === 'summarize_page'
      ? `Tóm tắt: ${shortUrl(tab.url)} • (không lấy được nội dung)`
      : `Giải thích: ${shortUrl(tab.url)} • (không lấy được nội dung)`;
    els.contextHint.classList.add('show');
    els.contextHint.classList.remove('multiline');
    return;
  }

  if (mode === 'summarize_page') {
    const lines = pageText ? countLines(pageText) : 0;
    const chars = pageText ? pageText.length : 0;
    els.contextHint.textContent = `Tóm tắt: ${shortUrl(tab.url)} • ${lines} dòng • ${chars.toLocaleString()} ký tự`;
    els.contextHint.classList.remove('multiline');
  } else {
    const hasSel = selectionText && selectionText.trim().length > 0;
    const lines = hasSel ? countLines(selectionText) : 0;
    const chars = hasSel ? selectionText.length : 0;
    if (!hasSel) {
      els.contextHint.textContent = `Giải thích: ${shortUrl(tab.url)} • Chưa chọn đoạn nào`;
      els.contextHint.classList.remove('multiline');
    } else {
      const preview = truncate(selectionText.trim().replace(/\s+/g, ' '), 140);
      els.contextHint.textContent = `Giải thích: ${shortUrl(tab.url)} • ${lines} dòng • ${chars.toLocaleString()} ký tự • ${preview}`;
      els.contextHint.classList.add('multiline'); // cho phép tối đa 2 dòng
    }
  }
  els.contextHint.classList.add('show');
}

function countLines(text) {
  return text ? text.split(/\r?\n/).length : 0;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    const hostFull = u.host || '';
    const host = hostFull.length > 18 ? `…${hostFull.slice(-18)}` : hostFull;
    const path = u.pathname || '';

    // Prefer showing last meaningful segment (often an id) shortened
    const parts = path.split('/').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : '';
    const head = parts.length ? parts[0] : '';

    const shortLast = last.length > 10 ? `${last.slice(0, 8)}…${last.slice(-3)}` : last;
    const composed = last
      ? `${host}/${head ? `${head}/` : ''}${shortLast}`
      : host;

    // hard cap with double-ellipsis if still long
    if (composed.length <= 32) return composed;
    return `${composed.slice(0, 14)}…${composed.slice(-14)}…`;
  } catch {
    const s = String(url || '');
    if (s.length <= 32) return s;
    return `${s.slice(0, 14)}…${s.slice(-14)}…`;
  }
}

function truncate(text, maxLen) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function formatTime(ms) {
  if (!ms) return '';
  try {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '';
  }
}

function renderMarkdown(input) {
  try {
    const originalText = normalizeMathBackslashes(String(input || ''));
    const { text, blocks } = extractMathBlocks(originalText);
    const lines = text.split(/\r?\n/);

    let html = '';
    let i = 0;
    let inCode = false;
    let codeLang = '';
    let codeLines = [];

    while (i < lines.length) {
      const line = lines[i];

      // fenced code block ```lang
      const fence = line.match(/^```(\w+)?\s*$/);
      if (fence) {
        if (!inCode) {
          inCode = true;
          codeLang = fence[1] || '';
          codeLines = [];
        } else {
          // close
          html += renderCodeBlock(codeLines.join('\n'), codeLang);
          inCode = false;
          codeLang = '';
          codeLines = [];
        }
        i += 1;
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        i += 1;
        continue;
      }

      // blank line -> paragraph break
      if (line.trim() === '') {
        html += '<div class="md-spacer"></div>';
        i += 1;
        continue;
      }

      // Detect markdown table block
      if (looksLikeTableStart(lines, i)) {
        const { tableHtml, nextIndex } = renderTableBlock(lines, i);
        html += tableHtml;
        i = nextIndex;
        continue;
      }

      // heading: #..###### (we'll map #->h2 to avoid huge)
      const h = line.match(/^(#{1,6})\s+(.+)\s*$/);
      if (h) {
        const level = Math.min(6, h[1].length);
        const tag = level <= 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
        html += `<${tag} class="md-heading">${renderInlineMarkdown(escapeHtml(h[2]))}</${tag}>`;
        i += 1;
        continue;
      }

      // blockquote
      if (/^\s*>\s?/.test(line)) {
        const qLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          qLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        const qHtml = qLines
          .map((l) => renderInlineMarkdown(escapeHtml(l)))
          .join('<br>');
        html += `<blockquote class="md-quote">${qHtml}</blockquote>`;
        continue;
      }

      // unordered list / ordered list blocks
      if (/^\s*([-*])\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const { listHtml, nextIndex } = renderListBlock(lines, i);
        html += listHtml;
        i = nextIndex;
        continue;
      }

      // horizontal rule
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        html += '<hr class="md-hr" />';
        i += 1;
        continue;
      }

      // paragraph (consume until blank)
      const pLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        // stop if next starts a block
        if (looksLikeTableStart(lines, i)) break;
        if (/^```/.test(lines[i])) break;
        if (/^(#{1,6})\s+/.test(lines[i])) break;
        if (/^\s*>\s?/.test(lines[i])) break;
        if (/^\s*([-*])\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i])) break;
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])) break;
        pLines.push(lines[i]);
        i += 1;
      }
      const pHtml = pLines
        .map((l) => renderInlineMarkdown(escapeHtml(rehydrateMathTokens(l, blocks))))
        .join('<br>');
      html += `<p class="md-p">${pHtml}</p>`;
    }

    // if file ended inside code fence, render it anyway
    if (inCode) {
      html += renderCodeBlock(codeLines.join('\n'), codeLang);
    }

    // After building HTML, expand math tokens into raw blocks (no <br> inside)
    html = finalizeMathTokens(html, blocks);
    return html;
  } catch (e) {
    // fallback: plain escaped text
    return escapeHtml(normalizeMathBackslashes(String(input || ''))).replace(/\r?\n/g, '<br>');
  }
}

function normalizeMathBackslashes(text) {
  // Some responses may contain HTML entity for backslash
  return String(text || '').replace(/&#92;/g, '\\');
}

function extractMathBlocks(text) {
  const blocks = [];
  let s = String(text || '');

  // Extract $$...$$ blocks
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
    const idx = blocks.length;
    blocks.push({ type: 'math', display: true, expr: inner });
    return `@@MATH_BLOCK_${idx}@@`;
  });

  // Extract \[...\] blocks
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => {
    const idx = blocks.length;
    blocks.push({ type: 'math', display: true, expr: inner });
    return `@@MATH_BLOCK_${idx}@@`;
  });

  // Extract \( ... \) inline math
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => {
    const idx = blocks.length;
    blocks.push({ type: 'math', display: false, expr: inner });
    return `@@MATH_BLOCK_${idx}@@`;
  });

  return { text: s, blocks };
}

function rehydrateMathTokens(line, blocks) {
  // Keep tokens as-is in line; finalize later in full HTML.
  // This function exists so future inline escaping doesn't break tokens.
  return line;
}

function finalizeMathTokens(html, blocks) {
  let out = html;
  for (let i = 0; i < blocks.length; i += 1) {
    const token = `@@MATH_BLOCK_${i}@@`;
    const b = blocks[i];
    const rendered = renderMathExpr(b.expr, b.display);
    out = out.split(token).join(rendered);
  }
  return out;
}

function renderMathExpr(expr, displayMode) {
  const mathExpr = String(expr || '');
  try {
    if (window.katex && typeof window.katex.renderToString === 'function') {
      const html = window.katex.renderToString(mathExpr, {
        displayMode: !!displayMode,
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
      });
      return displayMode ? `<div class="md-math">${html}</div>` : html;
    }
  } catch {
    // fallback below
  }
  const safe = escapeHtml(mathExpr);
  return displayMode ? `<div class="md-math">${safe}</div>` : safe;
}

function looksLikeTableStart(lines, idx) {
  const header = lines[idx] || '';
  const sep = lines[idx + 1] || '';
  if (!header.includes('|')) return false;
  // separator row must have dashes and pipes (markdown table)
  return /^\s*\|?[\s:-]+\|[\s|:-]*\s*$/.test(sep) && sep.includes('-') && sep.includes('|');
}

function renderTableBlock(lines, startIdx) {
  const headerLine = lines[startIdx];
  const sepLine = lines[startIdx + 1];
  const tableLines = [headerLine, sepLine];
  let i = startIdx + 2;
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    tableLines.push(lines[i]);
    i += 1;
  }

  const rows = tableLines.map((l) => splitTableRow(l));
  const headerCells = rows[0];
  const bodyRows = rows.slice(2); // skip header + separator

  let tableHtml = '<div class="md-table"><table><thead><tr>';
  for (const c of headerCells) {
    tableHtml += `<th>${renderInlineMarkdown(escapeHtml(c.trim()))}</th>`;
  }
  tableHtml += '</tr></thead><tbody>';

  for (const r of bodyRows) {
    tableHtml += '<tr>';
    for (let ci = 0; ci < headerCells.length; ci += 1) {
      const cell = (r[ci] || '').trim();
      tableHtml += `<td>${renderInlineMarkdown(escapeHtml(cell))}</td>`;
    }
    tableHtml += '</tr>';
  }

  tableHtml += '</tbody></table></div>';
  return { tableHtml, nextIndex: i };
}

function splitTableRow(line) {
  // remove outer pipes then split
  let s = String(line || '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((x) => x.trim());
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(escaped) {
  let s = escaped;
  // inline code: `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // links: [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  // bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic: *text* (simple)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

function typesetMath(containerEl) {
  // no-op: math is rendered directly in renderMarkdown via tokens
  return containerEl;
}

function renderCodeBlock(code, lang) {
  const safe = escapeHtml(code);
  const label = lang ? `<div class="md-code-lang">${escapeHtml(lang)}</div>` : '';
  return `<pre class="md-code">${label}<code>${safe}</code></pre>`;
}

function renderListBlock(lines, startIdx) {
  const isOrdered = /^\s*\d+\.\s+/.test(lines[startIdx]);
  const tag = isOrdered ? 'ol' : 'ul';
  let i = startIdx;
  let html = `<${tag} class="md-list">`;

  while (i < lines.length) {
    const line = lines[i];
    const m = isOrdered
      ? line.match(/^\s*(\d+)\.\s+(.+)\s*$/)
      : line.match(/^\s*([-*])\s+(.+)\s*$/);
    if (!m) break;
    const content = isOrdered ? m[2] : m[2];
    html += `<li>${renderInlineMarkdown(escapeHtml(content))}</li>`;
    i += 1;
  }

  html += `</${tag}>`;
  return { listHtml: html, nextIndex: i };
}

function saveConversations() {
  chrome.runtime.sendMessage(
    {
      type: 'SAVE_CONVERSATIONS',
      payload: { conversations },
    },
    () => {},
  );
}

init();


