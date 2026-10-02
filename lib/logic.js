(function (root) {
  const numeric = value => {
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw new Error('余额格式异常');
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('余额格式异常');
    return n;
  };
  function parseBalance(data) {
    if (!data || typeof data.is_available !== 'boolean' || !Array.isArray(data.balance_infos)) throw new Error('余额接口响应格式异常');
    const row = data.balance_infos.find(item => item?.currency === 'CNY') || data.balance_infos.find(item => item?.currency === 'USD');
    if (!row) throw new Error('账户没有可读取的 CNY 或 USD 余额');
    return {currency: row.currency, amount: numeric(row.total_balance), granted: numeric(row.granted_balance), toppedUp: numeric(row.topped_up_balance), available: data.is_available};
  }
  function riceLevel(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (amount < 10) return .12;
    if (amount <= 50) return .5;
    return Math.min(1, .5 + (amount - 50) / 50 * .5);
  }
  function transition(previous, next) {
    if (!previous || !next || previous.currency !== next.currency) return 'none';
    const delta = Math.round(next.amount * 1e6) - Math.round(previous.amount * 1e6);
    return delta < 0 ? 'eat' : delta > 0 ? 'refill' : 'none';
  }
  function validateSettings(input) {
    if (!input || typeof input !== 'object') throw new Error('设置参数不正确');
    const uiScale = input.uiScale === undefined ? 1 : Number(input.uiScale);
    return {uiScale: validateUiScale(uiScale)};
  }
  function validateUiScale(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < .7 || value > 1.6) throw new Error('界面大小需为 70%–160%');
    return Math.round(value * 100) / 100;
  }
  function validateApiKey(value) {
    if (typeof value !== 'string') throw new Error('API Key 格式不正确');
    const result = value.trim();
    if (!result || result.length > 512 || /\s/.test(result)) throw new Error('API Key 格式不正确');
    return result;
  }
  const api = {parseBalance, riceLevel, transition, validateSettings, validateUiScale, validateApiKey};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WhaleLogic = api;
})(globalThis);
