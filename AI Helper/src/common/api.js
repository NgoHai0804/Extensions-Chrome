// API layer (classic script for service worker importScripts)
// Requires vendor libs loaded first in background:
// - jsrsasign-all-min.js (KEYUTIL, hextob64)
// - crypto-js.min.js (CryptoJS)

(function initApi(global) {
  const JS_URL =
    'https://cdn.notegpt.io/notegpt/tools/ai-story-generator/v1/js/app.641abe2a.js';
  const APP_ID = 'nc_ai_ng';
  const QUESTION_URL = 'https://extensiondock.com/chatgpt/v3/question';

  let staticToken = null;
  let publicKeyPem = null;
  let loadingPromise = null;

  async function ensureTokenAndKeyLoaded() {
    if (staticToken && publicKeyPem) return;
    if (!loadingPromise) {
      loadingPromise = (async () => {
        const resp = await fetch(JS_URL);
        if (!resp.ok) throw new Error(`Không tải được JS cấu hình: ${resp.status}`);
        const content = await resp.text();
        const { token, rsaKey } = extractStaticTokenAndRsaKey(content);
        if (!token || !rsaKey) throw new Error('Không thể trích xuất STATIC_TOKEN hoặc RSA_PUBLIC_KEY');
        staticToken = token;
        publicKeyPem = rsaKey;
      })();
    }
    return loadingPromise;
  }

  function extractStaticTokenAndRsaKey(content) {
    // tương đương: re.findall(r'\bu\s*=\s*[\'"]([^\'"]+)[\'"]', content)
    const tokenRegex = /\bu\s*=\s*['"]([^'"]+)['"]/g;
    const matches = [];
    let m;
    while ((m = tokenRegex.exec(content)) !== null) matches.push(m[1]);
    const token = matches.length >= 2 ? matches[1] : null;

    const rsaRegex =
      /RSA_PUBLIC_KEY\s*=\s*['"]-----BEGIN PUBLIC KEY-----\\n(.*?)\\n-----END PUBLIC KEY-----['"]/s;
    const rsaMatch = content.match(rsaRegex);
    let rsaKey = null;
    if (rsaMatch) {
      const body = rsaMatch[1].replace(/\\n/g, '\n');
      rsaKey = `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
    }
    return { token, rsaKey };
  }

  function randomW16() {
    let w = '';
    for (let i = 0; i < 16; i++) {
      w += uuidV4().replace(/-/g, '').slice(0, 1);
    }
    return w;
  }

  function uuidV4() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }

    // fallback UUIDv4
    const bytes = new Uint8Array(16);
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }

    // Set version and variant bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function generateSignedQuery(text) {
    await ensureTokenAndKeyLoaded();

    const t = Math.floor(Date.now() / 1000);
    const nonce = uuidV4();
    const uid = uuidV4();
    const w = randomW16();

    const rsaKey = KEYUTIL.getKey(publicKeyPem);
    const encryptedHex = rsaKey.encrypt(w); // PKCS#1 v1.5
    const secretKey = hextob64(encryptedHex);

    const signString = `${APP_ID}:${staticToken}:${t}:${nonce}:${secretKey}`;
    const key = CryptoJS.enc.Utf8.parse(w);
    const iv = CryptoJS.enc.Utf8.parse(w);
    const encrypted = CryptoJS.AES.encrypt(signString, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    const sign = encrypted.ciphertext.toString(CryptoJS.enc.Base64);

    return { app_id: APP_ID, t, nonce, sign, secret_key: secretKey, uid, text };
  }

  async function callAI(params) {
    const { message, model } = params;
    const settings = await global.AIHelperStorage.getSettings();
    const finalModel = model || settings.defaultModel || 'gpt-4o-mini';

    const query = await generateSignedQuery(message);
    const url = new URL(settings.apiUrl || QUESTION_URL);
    url.searchParams.set('app_id', query.app_id);
    url.searchParams.set('t', String(query.t));
    url.searchParams.set('nonce', query.nonce);
    url.searchParams.set('sign', query.sign);
    url.searchParams.set('secret_key', query.secret_key);
    url.searchParams.set('uid', query.uid);

    const headers = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Referer: 'https://notegpt.io/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    };

    const body = { text: query.text, end_flag: true, streaming: false, model: finalModel };

    const resp = await fetch(url.toString(), { method: 'POST', headers, body: JSON.stringify(body) });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`AI API error: ${resp.status} ${errText || resp.statusText}`);
    }

    const data = await resp.json();
    const rawText = (data && data.data) || '';
    const textOut = String(rawText).replace(/\\n\\n/g, '\\n');
    return { text: textOut };
  }

  async function callAIStream(params) {
    const { message, model, onDelta } = params;
    const settings = await global.AIHelperStorage.getSettings();
    const finalModel = model || settings.defaultModel || 'gpt-4o-mini';

    const query = await generateSignedQuery(message);
    const url = new URL(settings.apiUrl || QUESTION_URL);
    url.searchParams.set('app_id', query.app_id);
    url.searchParams.set('t', String(query.t));
    url.searchParams.set('nonce', query.nonce);
    url.searchParams.set('sign', query.sign);
    url.searchParams.set('secret_key', query.secret_key);
    url.searchParams.set('uid', query.uid);

    const headers = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Referer: 'https://notegpt.io/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    };

    const body = { text: query.text, end_flag: true, streaming: true, model: finalModel };

    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`AI API error: ${resp.status} ${errText || resp.statusText}`);
    }

    if (!resp.body) {
      // fallback: try read as text
      const t = await resp.text();
      return { text: t };
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events separated by blank line; we only need data: lines
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split(/\r?\n/);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            return { text: full };
          }

          // data: {"message":"..."}  OR other json fields
          let delta = '';
          try {
            const obj = JSON.parse(payload);
            delta = obj.message || obj.text || '';
          } catch {
            // sometimes payload may be plain text
            delta = payload;
          }

          if (delta) {
            full += delta;
            if (typeof onDelta === 'function') {
              try {
                onDelta(delta, full);
              } catch {
                // ignore UI callback errors
              }
            }
          }
        }
      }
    }

    return { text: full };
  }

  global.AIHelperApi = { callAI, callAIStream };
})(self);



