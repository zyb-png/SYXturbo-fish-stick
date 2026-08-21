import fs from 'node:fs';

const base = (process.env.MANFEI_SMOKE_BASE || 'http://127.0.0.1:4177').replace(/\/$/, '');
const env = readEnv();
const username = process.env.APP_USERNAME || env.APP_USERNAME || '';
const password = process.env.APP_PASSWORD || env.APP_PASSWORD || '';

const expectedModels = {
  'mini-manfei-new': { resolutions: ['480p', '720p'], maxDuration: 15 },
  'moon-manfei-new': { resolutions: ['480p', '720p'], maxDuration: 15 },
  'star-manfei-new': { resolutions: ['480p', '720p'], maxDuration: 30 },
  'sun-manfei-new': { resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15 },
};

function readEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync('.env', 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1)];
        })
    );
  } catch {
    return {};
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { response, data, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ok(message) {
  console.log(`OK ${message}`);
}

async function main() {
  const index = await request('/');
  assert(index.response.ok, `首页不可访问：HTTP ${index.response.status}`);
  for (const model of Object.keys(expectedModels)) {
    assert(index.text.includes(model), `首页缺少模型：${model}`);
  }
  ok('首页模型选项完整');

  const app = await request('/app.js');
  assert(app.response.ok, `app.js 不可访问：HTTP ${app.response.status}`);
  assert(app.text.includes('star-manfei-new') && app.text.includes('Math.min(max'), '前端缺少 star 30 秒动态时长逻辑');
  assert(app.text.includes('4k'), '前端缺少 sun 4k 分辨率逻辑');
  ok('前端模型、分辨率、时长逻辑存在');

  assert(username && password, '缺少 APP_USERNAME / APP_PASSWORD，无法检查登录后的接口');
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert(login.response.ok, `登录失败：HTTP ${login.response.status}`);
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0] || '';
  assert(cookie, '登录没有返回会话 Cookie');
  ok('登录接口正常');

  const authHeaders = { headers: { cookie } };
  const capabilities = await request('/api/model-capabilities', authHeaders);
  assert(capabilities.response.ok, `模型能力接口失败：HTTP ${capabilities.response.status}`);
  const models = new Map((capabilities.data.models || []).map(item => [item.model, item]));
  for (const [model, expected] of Object.entries(expectedModels)) {
    const item = models.get(model);
    assert(item, `模型能力缺少：${model}`);
    assert(Number(item.max_duration) === expected.maxDuration, `${model} 时长上限错误`);
    for (const resolution of expected.resolutions) {
      assert(item.resolutions.includes(resolution), `${model} 缺少分辨率：${resolution}`);
    }
  }
  ok('模型能力接口完整');

  const pricing = await request('/api/pricing', authHeaders);
  assert(pricing.response.ok, `价格表接口失败：HTTP ${pricing.response.status}`);
  const prices = new Set((pricing.data.items || []).map(item => `${item.model}/${item.resolution}`));
  for (const [model, expected] of Object.entries(expectedModels)) {
    for (const resolution of expected.resolutions) {
      assert(prices.has(`${model}/${resolution}`), `价格表缺少：${model}/${resolution}`);
    }
  }
  ok('价格表覆盖所有支持组合');

  console.log('只读自检完成：没有提交生成任务，不会扣费。');
}

main().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
