const {parseBalance} = require('./logic.js');
async function fetchBalance(key, fetcher = fetch) {
  const response = await fetcher('https://api.deepseek.com/user/balance', {
    method: 'GET', headers: {Authorization: `Bearer ${key}`, Accept: 'application/json'},
    signal: AbortSignal.timeout(12000), redirect: 'error'
  });
  if (!response.ok) {
    const errors = {401: 'API Key 无效，请重新填写', 403: '账户没有查询余额的权限', 429: '查询太频繁，稍后自动重试', 500: 'DeepSeek 服务暂时异常', 503: 'DeepSeek 服务暂时不可用'};
    throw new Error(errors[response.status] || `余额查询失败（HTTP ${response.status}）`);
  }
  return parseBalance(await response.json());
}
module.exports = {fetchBalance};
