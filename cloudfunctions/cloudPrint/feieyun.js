// cloudfunctions/cloudPrint/feieyun.js
const https = require('https');
const http = require('http');
const querystring = require('querystring');
const crypto = require('crypto');

function safeStr(v) { return String(v == null ? '' : v).trim(); }
function sha1Hex(str) {
  return crypto.createHash('sha1').update(String(str || ''), 'utf8').digest('hex');
}

// [核心改造] 不再读取环境变量，只依赖传入的配置
function getFeieCredentials(cfg = {}) {
  const config = cfg || {};
  const user = safeStr(config.user);
  const ukey = safeStr(config.ukey);

  if (!user || !ukey) {
    const err = new Error('缺少飞鹅云USER或UKEY配置');
    err.code = 'MISSING_FEIE_CREDENTIALS';
    throw err;
  }
  return { user, ukey };
}

function postForm({ host, path, data, timeoutMs = 8000, useHttps = true }) {
  const body = querystring.stringify(data || {});
  const mod = useHttps ? https : http;
  const opts = {
    hostname: host,
    path,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Content-Length': Buffer.byteLength(body) },
    timeout: timeoutMs,
  };
  return new Promise((resolve, reject) => {
    const req = mod.request(opts, (res) => {
      let raw = '';
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error('http_status_' + res.statusCode);
          err.statusCode = res.statusCode;
          err.body = raw;
          return reject(err);
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) {
          const err = new Error('invalid_json');
          err.body = raw;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// [核心改造] 接受 feieConfig 对象
async function openApi(apiname, params, feieConfig) {
  const { user, ukey } = getFeieCredentials(feieConfig);
  const host = 'api.feieyun.cn';
  const path = '/Api/Open/';
  const useHttps = true;

  const stime = Math.floor(Date.now() / 1000);
  const sig = sha1Hex(user + ukey + stime);
  const payload = { user, stime, sig, apiname, ...(params || {}) };

  const out = await postForm({ host, path, data: payload, useHttps });

  if (out && typeof out.ret !== 'undefined' && Number(out.ret) !== 0) {
    const err = new Error(String(out.msg || out.data || 'feie_error'));
    err.code = 'feie_ret_' + String(out.ret);
    err.feie = out;
    throw err;
  }
  return out;
}

function ensureContentLimit(content) {
  const s = String(content || '');
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes > 5000) {
    const err = new Error('content_too_long');
    err.code = 'content_too_long';
    err.bytes = bytes;
    throw err;
  }
  return s;
}

// [核心改造] 接受 feieConfig 对象
async function printMsg({ sn, content, times = 1 }, feieConfig) {
  const s = safeStr(sn);
  if (!s) {
    const err = new Error('missing_sn');
    err.code = 'missing_sn';
    throw err;
  }
  const t = parseInt(times, 10) || 1;
  const safeTimes = Math.max(1, Math.min(9, t));
  const c = ensureContentLimit(content);

  return await openApi('Open_printMsg', { sn: s, content: c, times: safeTimes }, feieConfig);
}

// [核心改造] 接受 feieConfig 对象
async function queryPrinterStatus({ sn }, feieConfig) {
  const s = safeStr(sn);
  if (!s) {
    const err = new Error('missing_sn');
    err.code = 'missing_sn';
    throw err;
  }
  return await openApi('Open_queryPrinterStatus', { sn: s }, feieConfig);
}

module.exports = { printMsg, queryPrinterStatus };
