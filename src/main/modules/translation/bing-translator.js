const https = require('https');

function requestText(urlString, options = {}) {
  const { method = 'GET', headers = {}, body = '' } = options;

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }

    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      rejectUnauthorized: false // 允许自签名证书
    };

    const request = https.request(requestOptions, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        let responseText;
        const buffer = Buffer.concat(chunks);

        // 检查是否是 gzip 压缩
        const contentEncoding = response.headers['content-encoding'];
        if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
          try {
            const zlib = require('zlib');
            responseText =
              contentEncoding === 'gzip'
                ? zlib.gunzipSync(buffer).toString('utf8')
                : zlib.inflateSync(buffer).toString('utf8');
          } catch (decompressError) {
            console.error('[Translation] Decompress error:', decompressError.message);
            responseText = buffer.toString('utf8');
          }
        } else {
          responseText = buffer.toString('utf8');
        }

        let json = null;
        if (responseText) {
          try {
            json = JSON.parse(responseText);
          } catch (error) {
            json = null;
          }
        }

        resolve({
          statusCode: response.statusCode || 500,
          headers: response.headers,
          bodyText: responseText,
          json,
          finalUrl: urlString
        });
      });
    });

    request.on('error', error => {
      console.error('[Translation] Request error:', error.message);
      reject(error);
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function mergeCookies(cookieJar, setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];

  headers.forEach(item => {
    const pair = String(item).split(';')[0];
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) return;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (!key) return;
    cookieJar[key] = value;
  });
}

function serializeCookies(cookieJar) {
  return Object.entries(cookieJar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function resolveRedirectUrl(currentUrl, location) {
  if (!location) return '';
  if (/^https?:\/\//i.test(location)) return location;
  return new URL(location, currentUrl).toString();
}

const BING_TRANSLATOR_URL = 'https://www.bing.com/translator';
const BING_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/122.0.0.0',
  'Safari/537.36'
].join(' ');

let cachedBingSession = null;

function parseBingSession(html, pageUrl, cookieJar) {
  const igMatch = html.match(/IG:"([^"]+)"/);
  const iidMatch = html.match(/data-iid="([^"]+)"/);
  const abuseMatch = html.match(/params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/);

  if (!igMatch || !iidMatch || !abuseMatch) {
    return null;
  }

  const parts = abuseMatch[1].split(',');
  const key = parts[0] ? parts[0].trim() : '';
  const token = parts[1] ? parts[1].trim().replace(/^"|"$/g, '') : '';
  const intervalMs = Number.parseInt(parts[2] || '', 10) || 300000;

  if (!key || !token) {
    return null;
  }

  return {
    origin: new URL(pageUrl).origin,
    referer: pageUrl,
    ig: igMatch[1],
    iid: iidMatch[1],
    key,
    token,
    cookieJar: { ...cookieJar },
    requestSeq: 1,
    expiresAt: Date.now() + Math.max(60000, intervalMs - 30000)
  };
}

async function getBingSession(forceRefresh = false) {
  if (!forceRefresh && cachedBingSession && cachedBingSession.expiresAt > Date.now()) {
    return cachedBingSession;
  }

  let currentUrl = BING_TRANSLATOR_URL;
  const cookieJar = {};
  let pageResult = null;

  for (let i = 0; i < 6; i += 1) {
    const result = await requestText(currentUrl, {
      method: 'GET',
      headers: {
        'User-Agent': BING_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    mergeCookies(cookieJar, result.headers['set-cookie']);

    if ([301, 302, 307, 308].includes(result.statusCode) && result.headers.location) {
      currentUrl = resolveRedirectUrl(currentUrl, result.headers.location);
      continue;
    }

    pageResult = result;
    break;
  }

  if (!pageResult || pageResult.statusCode < 200 || pageResult.statusCode >= 300) {
    throw new Error('Failed to load Bing translator page');
  }

  const session = parseBingSession(pageResult.bodyText, currentUrl, cookieJar);
  if (!session) {
    throw new Error('Failed to parse Bing translation token');
  }

  cachedBingSession = session;
  return cachedBingSession;
}

function extractBingTranslation(bodyText) {
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    console.error('[Translation] Failed to parse Bing response:', error.message);
    console.error('[Translation] Response text (first 200 chars):', bodyText.substring(0, 200));
    return '';
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    console.error('[Translation] Invalid payload structure');
    return '';
  }

  const firstRow = payload[0];
  if (!firstRow || !Array.isArray(firstRow.translations)) {
    console.error('[Translation] No translations in response');
    return '';
  }

  const firstTranslation = firstRow.translations[0];
  const result = firstTranslation && firstTranslation.text ? firstTranslation.text : '';

  return result;
}

async function translateTextWithBing(text, targetLanguage, retry = true) {
  let session;
  try {
    session = await getBingSession(!retry);
  } catch (sessionError) {
    console.error('[Bing翻译] 获取会话失败:', sessionError.message);
    throw sessionError;
  }

  const query = new URLSearchParams({
    isVertical: '1',
    IG: session.ig,
    IID: `${session.iid}.${session.requestSeq++}`
  });
  const url = `${session.origin}/ttranslatev3?${query.toString()}`;

  const body = new URLSearchParams({
    fromLang: 'auto-detect',
    text,
    to: targetLanguage,
    token: session.token,
    key: session.key
  }).toString();

  const result = await requestText(url, {
    method: 'POST',
    body,
    headers: {
      'User-Agent': BING_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      Referer: session.referer,
      Origin: session.origin,
      Accept: '*/*',
      Cookie: serializeCookies(session.cookieJar)
    }
  });

  if (result.statusCode === 429 && retry) {
    cachedBingSession = null;
    return translateTextWithBing(text, targetLanguage, false);
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Bing translate request failed (${result.statusCode})`);
  }

  const translated = extractBingTranslation(result.bodyText);
  if (!translated) {
    throw new Error('Bing translation result is empty');
  }

  return translated;
}

module.exports = {
  translateTextWithBing
};
