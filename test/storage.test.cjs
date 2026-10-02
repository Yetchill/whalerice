const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {SecretStore} = require('../lib/storage.cjs');
const work = path.resolve(__dirname, '../../../work/storage-tests');
fs.mkdirSync(work, {recursive: true});
function profile(t) {
  const directory = fs.mkdtempSync(path.join(work, 'profile-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  return directory;
}
// This adapter models OS encryption for unit tests; production uses Electron safeStorage.
function systemStorage() {
  const encryptionKey = crypto.createHash('sha256').update('isolated-unit-test-system-key').digest();
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: value => {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString: value => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0,12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12,-16)), decipher.final()]).toString();
    }
  };
}
const unavailable = {isEncryptionAvailable:()=>false, getSelectedStorageBackend:()=> 'basic_text'};
test('系统加密写入后新实例可读回，文件没有明文 API Key', t => {
  const directory = profile(t), first = new SecretStore(directory, systemStorage());
  assert.equal(first.load(), '');
  assert.equal(first.save('sk-persistent-system-secret'), 'sk-persistent-system-secret');
  assert.ok(!fs.readFileSync(first.file,'utf8').includes('sk-persistent-system-secret'));
  assert.equal(new SecretStore(directory, systemStorage()).load(), 'sk-persistent-system-secret');
  assert.match(first.status(), /重启后自动读取/);
});
test('Linux basic_text 被拒绝，使用 AES-GCM；重启与后续系统加密升级均不丢失 Key', t => {
  const directory = profile(t), basic = {isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'basic_text'};
  const first = new SecretStore(directory, basic, {platform:'linux'});
  first.load(); first.save('sk-linux-persistent-secret');
  assert.equal(JSON.parse(fs.readFileSync(first.file,'utf8')).method,'local-aes-gcm');
  assert.ok(!fs.readFileSync(first.file,'utf8').includes('sk-linux-persistent-secret'));
  assert.equal(fs.readFileSync(first.localKeyFile).length,32);
  const restart = new SecretStore(directory, systemStorage(), {platform:'linux'});
  assert.equal(restart.load(),'sk-linux-persistent-secret');
  restart.save('sk-linux-persistent-secret');
  assert.equal(JSON.parse(fs.readFileSync(first.file,'utf8')).method,'system');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(first.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(first.localKeyFile).mode & 0o777,0o600);
    assert.equal(fs.statSync(first.file).mode & 0o777,0o600);
  }
});
test('退出进程后，从独立第二进程读取 Linux 后备持久化 Key', t => {
  const directory = profile(t), modulePath = path.resolve(__dirname,'../lib/storage.cjs');
  const first = spawnSync(process.execPath, ['-e', `const {SecretStore}=require(process.argv[1]); const s=new SecretStore(process.argv[2],{isEncryptionAvailable:()=>false},{platform:'linux'}); s.load(); s.save('sk-process-restart-test');`, modulePath, directory], {encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);
  const restart = spawnSync(process.execPath, ['-e', `const assert=require('node:assert/strict'); const {SecretStore}=require(process.argv[1]); const s=new SecretStore(process.argv[2],{isEncryptionAvailable:()=>false},{platform:'linux'}); assert.equal(s.load(),'sk-process-restart-test');`, modulePath, directory], {encoding:'utf8'});
  assert.equal(restart.status,0,restart.stderr);
});
test('旧版 encryptedKey 迁移后可重启读取，迁移不会写明文', t => {
  const directory=profile(t), os=systemStorage(), legacy=os.encryptString('sk-old-version-secret').toString('base64');
  const store=new SecretStore(directory,os); assert.equal(store.load(),'');
  assert.equal(store.migrateLegacy(legacy),'sk-old-version-secret');
  assert.equal(new SecretStore(directory,os).load(),'sk-old-version-secret');
  assert.ok(!fs.readFileSync(store.file,'utf8').includes('sk-old-version-secret'));
});
test('加密文件损坏或系统密钥库暂时失效时不覆盖原文件', t => {
  const directory=profile(t), store=new SecretStore(directory,systemStorage()); store.load(); store.save('sk-original-secret');
  const original=fs.readFileSync(store.file);
  const locked=new SecretStore(directory,unavailable,{platform:'linux'});
  assert.throws(()=>locked.load(), /原密钥文件已保留/);
  assert.throws(()=>locked.save('sk-replacement'), /禁止覆盖/);
  assert.deepEqual(fs.readFileSync(store.file),original);
  fs.writeFileSync(store.file,'{broken');
  const broken=new SecretStore(directory,systemStorage());
  assert.throws(()=>broken.load(), /无法读取/); assert.throws(()=>broken.save('sk-replacement'), /禁止覆盖/);
  assert.equal(fs.readFileSync(store.file,'utf8'),'{broken');
});
test('缺失 Linux 本机加密文件时保留密文且禁止生成新密钥覆盖', t => {
  const directory=profile(t), store=new SecretStore(directory,unavailable,{platform:'linux'}); store.load(); store.save('sk-local-original');
  const original=fs.readFileSync(store.file); fs.unlinkSync(store.localKeyFile);
  const restart=new SecretStore(directory,unavailable,{platform:'linux'});
  assert.throws(()=>restart.load(),/无法读取/); assert.throws(()=>restart.save('sk-new'),/禁止覆盖/);
  assert.deepEqual(fs.readFileSync(store.file),original); assert.ok(!fs.existsSync(store.localKeyFile));
});
test('写入后的读回验证失败会恢复旧密钥文件', t => {
  const directory=profile(t), first=new SecretStore(directory,systemStorage()); first.load(); first.save('sk-original-before-failure');
  const original=fs.readFileSync(first.file); let corruptNextRead=false, hasCorrupted=false;
  const faulty=Object.create(fs);
  faulty.renameSync=(from,to)=>{fs.renameSync(from,to); if(to===first.file && !hasCorrupted) corruptNextRead=true;};
  faulty.readFileSync=(file,...args)=>{
    if(file===first.file && corruptNextRead) {corruptNextRead=false;hasCorrupted=true;return '{corrupted-on-read}';}
    return fs.readFileSync(file,...args);
  };
  const store=new SecretStore(directory,systemStorage(),{filesystem:faulty}); store.load();
  assert.throws(()=>store.save('sk-new-that-must-not-stick'),/原密钥已保留/);
  assert.deepEqual(fs.readFileSync(first.file),original);
  assert.equal(new SecretStore(directory,systemStorage()).load(),'sk-original-before-failure');
});
test('Windows 或 macOS 无系统加密时返回保存失败，不声称已记住 Key', t => {
  const directory=profile(t), store=new SecretStore(directory,unavailable,{platform:'win32'}); store.load();
  assert.throws(()=>store.save('sk-cannot-persist'),/尚未保存/); assert.ok(!fs.existsSync(store.file)); assert.equal(store.status(),'尚未保存 API Key');
});
