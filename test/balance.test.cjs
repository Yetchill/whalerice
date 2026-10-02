const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseBalance, riceLevel, transition, validateSettings, validateUiScale, validateApiKey} = require('../lib/logic.js');
const {fetchBalance} = require('../lib/balance.cjs');
const fixture = {is_available: true, balance_infos: [{currency: 'CNY', total_balance: '110.0037', granted_balance: '10', topped_up_balance: '100.0037'}, {currency: 'USD', total_balance: '2.20', granted_balance: '0', topped_up_balance: '2.20'}]};
test('饭量边界与全区间单调变化', () => {
  for (const [amount, expected] of [[0,0],[.001,.12],[9.99,.12],[10,.5],[49,.5],[50,.5],[100,1],[200,1]]) assert.equal(riceLevel(amount), expected);
  let previous = 0; for (let amount = 0; amount <= 150; amount += .1) {const level = riceLevel(amount); assert.ok(level >= previous); assert.ok(level >= 0 && level <= 1); previous = level;}
});
test('自动优先人民币，没有人民币时读取美元', () => {
  assert.equal(parseBalance(fixture).amount, 110.0037); assert.equal(parseBalance(fixture).currency, 'CNY');
  assert.equal(parseBalance({...fixture, balance_infos: [fixture.balance_infos[1]]}).amount, 2.2);
  assert.throws(() => parseBalance({...fixture, balance_infos: []}), /没有可读取/);
  for (const bad of ['-1', 'NaN', 'Infinity', '12oops', '', null]) assert.throws(() => parseBalance({...fixture, balance_infos: [{...fixture.balance_infos[0], total_balance: bad}]}));
  assert.throws(() => parseBalance({balance_infos: fixture.balance_infos}));
});
test('下降吃饭，充值添饭，首次连接与币种切换不误触发', () => {
  const b = {currency:'CNY',amount:50};
  assert.equal(transition(null,b),'none'); assert.equal(transition(b,b),'none');
  assert.equal(transition(b,{...b,amount:49.9999}),'eat'); assert.equal(transition(b,{...b,amount:60}),'refill');
  assert.equal(transition(b,{currency:'USD',amount:3}),'none');
});
test('查询只发送到官方 HTTPS 余额 GET 接口并禁止重定向泄漏密钥', async () => {
  const balance = await fetchBalance('test-secret', async (url, options) => {
    assert.equal(url,'https://api.deepseek.com/user/balance'); assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer test-secret'); assert.equal(options.redirect,'error'); assert.ok(options.signal);
    assert.equal(options.body, undefined);
    return {ok:true,json:async()=>fixture};
  }); assert.equal(balance.amount,110.0037);
});
test('错误响应不当作零余额，不回显服务端敏感正文', async () => {
  await assert.rejects(fetchBalance('test-secret',async()=>({ok:false,status:401,json:async()=>({error:'test-secret'})})), /Key 无效/);
  await assert.rejects(fetchBalance('test-secret',async()=>({ok:true,json:async()=>({})})), /格式异常/);
  await assert.rejects(fetchBalance('test-secret',async()=>{throw new TypeError('network');}),/network/);
});
test('设置只接受界面大小，并验证 Key 文本', () => {
  assert.deepEqual(validateSettings({uiScale:1.15}), {uiScale:1.15});
  assert.deepEqual(validateSettings({}), {uiScale:1});
  for (const uiScale of [0,.69,1.61,'abc',Infinity,null]) assert.throws(()=>validateSettings({uiScale}));
  assert.equal(validateApiKey(' sk-test '), 'sk-test');
  for (const invalid of ['', 'sk-a b', 'a'.repeat(513), 42]) assert.throws(()=>validateApiKey(invalid));
});
test('实时缩放仅接受数值，不接受 Key 或可转换的字符串', () => {
  for (const value of [.7, 1, 1.6]) assert.equal(validateUiScale(value), value);
  assert.equal(validateUiScale(1.234), 1.23);
  for (const value of ['1', null, undefined, {uiScale:1,apiKey:'sk-injected'}, NaN, Infinity, .69, 1.61]) assert.throws(() => validateUiScale(value));
});
