const https = require('https');
const dns = require('dns');

/**
 * 诊断网络连接问题
 * @param {string} endpoint - API端点URL
 * @returns {Promise<Object>} 诊断结果
 */
async function diagnoseNetworkIssue(endpoint) {
  const results = {
    endpoint,
    timestamp: new Date().toISOString(),
    tests: {}
  };

  try {
    const parsedUrl = new URL(endpoint);
    results.parsedUrl = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      pathname: parsedUrl.pathname
    };

    // 测试1: DNS解析
    results.tests.dns = await testDNSResolution(parsedUrl.hostname);

    // 测试2: TCP连接
    results.tests.tcp = await testTCPConnection(parsedUrl.hostname, results.parsedUrl.port);

    // 测试3: HTTPS握手
    if (parsedUrl.protocol === 'https:') {
      results.tests.https = await testHTTPSHandshake(parsedUrl.hostname, results.parsedUrl.port);
    }

    // 测试4: HTTP请求
    results.tests.http = await testHTTPRequest(endpoint);

    // 生成诊断建议
    results.suggestions = generateSuggestions(results.tests);
  } catch (error) {
    results.error = error.message;
  }

  return results;
}

/**
 * 测试DNS解析
 */
function testDNSResolution(hostname) {
  return new Promise(resolve => {
    const startTime = Date.now();
    dns.resolve4(hostname, (err, addresses) => {
      const duration = Date.now() - startTime;
      if (err) {
        resolve({
          success: false,
          error: err.message,
          code: err.code,
          duration
        });
      } else {
        resolve({
          success: true,
          addresses,
          duration
        });
      }
    });
  });
}

/**
 * 测试TCP连接
 */
function testTCPConnection(hostname, port) {
  return new Promise(resolve => {
    const startTime = Date.now();
    const socket = require('net').createConnection(
      {
        host: hostname,
        port: port,
        timeout: 10000
      },
      () => {
        const duration = Date.now() - startTime;
        socket.destroy();
        resolve({
          success: true,
          duration
        });
      }
    );

    socket.on('error', err => {
      const duration = Date.now() - startTime;
      socket.destroy();
      resolve({
        success: false,
        error: err.message,
        code: err.code,
        duration
      });
    });

    socket.on('timeout', () => {
      const duration = Date.now() - startTime;
      socket.destroy();
      resolve({
        success: false,
        error: 'Connection timeout',
        code: 'ETIMEDOUT',
        duration
      });
    });
  });
}

/**
 * 测试HTTPS握手
 */
function testHTTPSHandshake(hostname, port) {
  return new Promise(resolve => {
    const startTime = Date.now();
    const socket = require('tls').connect(
      {
        host: hostname,
        port: port,
        rejectUnauthorized: false,
        timeout: 10000
      },
      () => {
        const duration = Date.now() - startTime;
        const cert = socket.getPeerCertificate();
        socket.destroy();
        resolve({
          success: true,
          duration,
          certificate: {
            subject: cert.subject,
            issuer: cert.issuer,
            valid_from: cert.valid_from,
            valid_to: cert.valid_to
          }
        });
      }
    );

    socket.on('error', err => {
      const duration = Date.now() - startTime;
      socket.destroy();
      resolve({
        success: false,
        error: err.message,
        code: err.code,
        duration
      });
    });

    socket.on('timeout', () => {
      const duration = Date.now() - startTime;
      socket.destroy();
      resolve({
        success: false,
        error: 'TLS handshake timeout',
        code: 'ETIMEDOUT',
        duration
      });
    });
  });
}

/**
 * 测试HTTP请求
 */
function testHTTPRequest(url) {
  return new Promise(resolve => {
    const startTime = Date.now();
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname,
      method: 'GET',
      timeout: 10000,
      rejectUnauthorized: false
    };

    const request = https.request(options, response => {
      const duration = Date.now() - startTime;
      response.resume(); // 消费响应数据
      resolve({
        success: true,
        statusCode: response.statusCode,
        headers: response.headers,
        duration
      });
    });

    request.on('error', err => {
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        error: err.message,
        code: err.code,
        duration
      });
    });

    request.on('timeout', () => {
      const duration = Date.now() - startTime;
      request.destroy();
      resolve({
        success: false,
        error: 'HTTP request timeout',
        code: 'ETIMEDOUT',
        duration
      });
    });

    request.end();
  });
}

/**
 * 生成诊断建议
 */
function generateSuggestions(tests) {
  const suggestions = [];

  if (!tests.dns?.success) {
    suggestions.push({
      issue: 'DNS解析失败',
      suggestion: '请检查网络连接和DNS设置。可以尝试更换DNS服务器（如8.8.8.8或1.1.1.1）。'
    });
  }

  if (!tests.tcp?.success) {
    if (tests.tcp?.code === 'ETIMEDOUT') {
      suggestions.push({
        issue: 'TCP连接超时',
        suggestion: '无法连接到服务器。可能原因：1) 防火墙阻止连接 2) 需要配置代理 3) 服务器不可达'
      });
    } else if (tests.tcp?.code === 'ECONNREFUSED') {
      suggestions.push({
        issue: '连接被拒绝',
        suggestion: '服务器拒绝连接。请检查API端点地址和端口是否正确。'
      });
    }
  }

  if (!tests.https?.success && tests.tcp?.success) {
    suggestions.push({
      issue: 'HTTPS握手失败',
      suggestion: 'SSL/TLS连接失败。可能原因：1) 证书问题 2) 协议版本不兼容 3) 中间人攻击防护'
    });
  }

  if (!tests.http?.success && tests.https?.success) {
    suggestions.push({
      issue: 'HTTP请求失败',
      suggestion: '连接建立成功但HTTP请求失败。请检查API端点路径是否正确。'
    });
  }

  if (suggestions.length === 0 && tests.http?.success) {
    suggestions.push({
      issue: '网络连接正常',
      suggestion: '所有网络测试通过。如果翻译仍然失败，请检查API密钥和请求格式。'
    });
  }

  return suggestions;
}

module.exports = {
  diagnoseNetworkIssue
};
