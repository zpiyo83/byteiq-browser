// 测试 AI 翻译请求构建
const https = require('https');
const dns = require('dns');
const net = require('net');

// 模拟你的配置
const testConfig = {
  endpoint: 'https://uqsntctjouzp.ap-southeast-1.clawcloudrun.com/v1',
  apiKey: 'your-api-key-here',
  requestType: 'openai-chat',
  model: 'openai/gpt-oss-20b',
  streaming: true
};

console.log('=== AI 翻译请求测试 ===\n');

// 构建请求
let url = testConfig.endpoint;
if (testConfig.requestType === 'openai-chat') {
  if (url.endsWith('/chat/completions')) {
    // 已经是完整路径
  } else if (url.endsWith('/v1') || url.endsWith('/v1/')) {
    url = url.replace(/\/$/, '') + '/chat/completions';
  } else {
    url = url + (url.endsWith('/') ? 'chat/completions' : '/chat/completions');
  }
}

console.log('最终 URL:', url);

const parsedUrl = new URL(url);
console.log('\n解析后的 URL:', {
  protocol: parsedUrl.protocol,
  hostname: parsedUrl.hostname,
  port: parsedUrl.port || '(空)',
  pathname: parsedUrl.pathname,
  search: parsedUrl.search
});

const requestBody = {
  model: testConfig.model,
  messages: [{ role: 'user', content: '测试消息' }],
  temperature: 0.3,
  stream: testConfig.streaming
};

const bodyString = JSON.stringify(requestBody, null, 2);
console.log('\n请求体:');
console.log(bodyString);

const actualPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);

const requestOptions = {
  protocol: parsedUrl.protocol,
  hostname: parsedUrl.hostname,
  port: actualPort,
  path: `${parsedUrl.pathname}${parsedUrl.search}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyString),
    Authorization: `Bearer ${testConfig.apiKey}`
  },
  rejectUnauthorized: false,
  timeout: 60000
};

console.log('\n请求选项:');
console.log(JSON.stringify(requestOptions, null, 2));

// 测试 DNS 解析
console.log('\n=== 1. 测试 DNS 解析 ===');
dns.resolve4(parsedUrl.hostname, (err, addresses) => {
  if (err) {
    console.error('❌ DNS 解析失败:', err.message);
    console.error('   错误代码:', err.code);
  } else {
    console.log('✅ DNS 解析成功:', addresses);

    // DNS 成功后测试 TCP 连接
    console.log('\n=== 2. 测试 TCP 连接 ===');
    console.log(`尝试连接到 ${parsedUrl.hostname}:${actualPort}...`);

    const socket = net.createConnection(
      {
        host: parsedUrl.hostname,
        port: actualPort,
        timeout: 10000
      },
      () => {
        console.log('✅ TCP 连接成功');
        socket.destroy();

        // TCP 成功后测试 HTTPS 请求
        console.log('\n=== 3. 测试 HTTPS 请求 ===');
        testHttpsRequest();
      }
    );

    socket.on('error', err => {
      console.error('❌ TCP 连接失败:', err.message);
      console.error('   错误代码:', err.code);
    });

    socket.on('timeout', () => {
      console.error('❌ TCP 连接超时（10秒）');
      socket.destroy();
    });
  }
});

function testHttpsRequest() {
  console.log('发送 HTTPS 请求...');

  const request = https.request(requestOptions, response => {
    console.log('✅ 收到响应，状态码:', response.statusCode);
    console.log('   响应头:', JSON.stringify(response.headers, null, 2));

    const chunks = [];
    response.on('data', chunk => {
      chunks.push(chunk);
    });

    response.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      console.log('\n响应体（前 500 字符）:');
      console.log(body.substring(0, 500));
    });
  });

  request.on('error', error => {
    console.error('❌ HTTPS 请求失败:', error.message);
    console.error('   错误代码:', error.code);
    console.error('   完整错误:', error);
  });

  request.on('timeout', () => {
    console.error('❌ HTTPS 请求超时（60秒）');
    request.destroy();
  });

  request.write(bodyString);
  request.end();
}
