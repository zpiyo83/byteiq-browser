/**
 * AI 模型列表获取
 */

const https = require('https');
const http = require('http');

function getHeaders(requestType, apiKey) {
  const headers = {
    Accept: 'application/json'
  };

  switch (requestType) {
    case 'openai-chat':
    case 'openai-response':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
  }

  return headers;
}

function buildModelsPath(endpoint) {
  const url = new URL(endpoint);
  const path = url.pathname || '';
  const v1Index = path.indexOf('/v1');

  if (v1Index !== -1) {
    return `${path.slice(0, v1Index)}/v1/models`;
  }

  if (path && path !== '/') {
    return `${path.replace(/\/+$/, '')}/v1/models`;
  }

  return '/v1/models';
}

function normalizeModelList(payload) {
  if (!payload) return [];

  let rawList = [];
  if (Array.isArray(payload.data)) {
    rawList = payload.data;
  } else if (Array.isArray(payload.models)) {
    rawList = payload.models;
  } else if (Array.isArray(payload)) {
    rawList = payload;
  }

  const ids = rawList.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    return item.id || item.model || item.name || item.slug || '';
  });

  return Array.from(new Set(ids.filter(Boolean))).sort();
}

function fetchAiModels(config) {
  return new Promise((resolve, reject) => {
    const { endpoint, apiKey, requestType, timeout } = config;

    if (!endpoint || !apiKey) {
      reject(new Error('AI endpoint and API key are required'));
      return;
    }

    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: buildModelsPath(endpoint),
      method: 'GET',
      headers: getHeaders(requestType, apiKey),
      timeout: timeout || 120000
    };

    const req = httpModule.request(options, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const payload = data ? JSON.parse(data) : null;
            resolve(normalizeModelList(payload));
          } catch (error) {
            const parseMessage = error && error.message ? error.message : String(error);
            reject(new Error(`Invalid model list response: ${parseMessage}`));
          }
          return;
        }

        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

module.exports = {
  fetchAiModels
};
