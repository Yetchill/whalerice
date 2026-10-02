const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateApiKey} = require('./logic.js');

// Keep the old file intact until a complete replacement has been flushed.
function atomicWrite(file, content, filesystem = fs) {
  const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = filesystem.openSync(temp, 'wx', 0o600);
    filesystem.writeFileSync(descriptor, content);
    filesystem.fsyncSync(descriptor);
    filesystem.closeSync(descriptor); descriptor = undefined;
    filesystem.renameSync(temp, file);
    if (process.platform !== 'win32') filesystem.chmodSync(file, 0o600);
  } finally {
    if (descriptor !== undefined) try {filesystem.closeSync(descriptor);} catch {}
    try {filesystem.unlinkSync(temp);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
}

class SecretStore {
  constructor(userData, safeStorage, {platform = process.platform, filesystem = fs} = {}) {
    this.fs = filesystem;
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.directory = path.join(userData, 'secure');
    this.file = path.join(this.directory, 'api-key.json');
    this.localKeyFile = path.join(this.directory, 'local.key');
    this.readFailed = false;
    this.method = null;
  }
  systemAvailable() {
    try {
      return this.safeStorage.isEncryptionAvailable() && (this.platform !== 'linux' || this.safeStorage.getSelectedStorageBackend() !== 'basic_text');
    } catch {return false;}
  }
  ensureDirectory() {
    this.fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
    if (this.platform !== 'win32') this.fs.chmodSync(this.directory, 0o700);
  }
  localKey(create) {
    if (create && !this.fs.existsSync(this.localKeyFile)) {
      const descriptor = this.fs.openSync(this.localKeyFile, 'wx', 0o600);
      try {this.fs.writeFileSync(descriptor, crypto.randomBytes(32)); this.fs.fsyncSync(descriptor);} finally {this.fs.closeSync(descriptor);}
    }
    const stat = this.fs.lstatSync(this.localKeyFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('本机加密密钥文件不正确');
    if (this.platform !== 'win32') this.fs.chmodSync(this.localKeyFile, 0o600);
    const localKey = this.fs.readFileSync(this.localKeyFile);
    if (localKey.length !== 32) throw new Error('本机加密密钥文件不正确');
    return localKey;
  }
  decrypt(record) {
    if (record?.version !== 1) throw new Error('密钥存储版本不受支持');
    if (record.method === 'system') {
      if (!this.systemAvailable()) throw new Error('系统密钥库暂时不可用');
      return validateApiKey(this.safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64')));
    }
    if (record.method === 'local-aes-gcm') {
      const iv = Buffer.from(record.iv, 'base64'), tag = Buffer.from(record.tag, 'base64');
      if (iv.length !== 12 || tag.length !== 16) throw new Error('加密密钥文件不正确');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.localKey(false), iv);
      decipher.setAAD(Buffer.from('WhaleRice API Key v1'));
      decipher.setAuthTag(tag);
      return validateApiKey(Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    }
    throw new Error('密钥存储方式不受支持');
  }
  load() {
    try {
      let raw;
      try {raw = this.fs.readFileSync(this.file, 'utf8');} catch (error) {if (error.code === 'ENOENT') return ''; throw error;}
      const record = JSON.parse(raw), key = this.decrypt(record);
      this.method = record.method;
      return key;
    } catch {
      this.readFailed = true;
      throw new Error('已保存的 API Key 无法读取，原密钥文件已保留。请恢复系统密钥库或原本机加密文件后重启。');
    }
  }
  save(value) {
    if (this.readFailed) throw new Error('为保护原密钥，读取异常时禁止覆盖。请先恢复原密钥存储后重启。');
    const key = validateApiKey(value);
    this.ensureDirectory();
    let record;
    if (this.systemAvailable()) {
      record = {version: 1, method: 'system', ciphertext: this.safeStorage.encryptString(key).toString('base64')};
    } else {
      if (this.platform !== 'linux') throw new Error('系统密钥库不可用，API Key 尚未保存。请启用系统密钥库后重试。');
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.localKey(true), iv);
      cipher.setAAD(Buffer.from('WhaleRice API Key v1'));
      const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
      record = {version: 1, method: 'local-aes-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')};
    }
    if (this.decrypt(record) !== key) throw new Error('API Key 加密验证失败，尚未保存');
    let previous;
    try {previous = this.fs.readFileSync(this.file);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    try {
      atomicWrite(this.file, JSON.stringify(record), this.fs);
      if (this.decrypt(JSON.parse(this.fs.readFileSync(this.file, 'utf8'))) !== key) throw new Error('API Key 写入验证失败');
      this.method = record.method;
      return key;
    } catch {
      try {
        if (previous !== undefined) atomicWrite(this.file, previous, this.fs);
        else try {this.fs.unlinkSync(this.file);} catch (error) {if (error.code !== 'ENOENT') throw error;}
      } catch {
        this.readFailed = true;
        throw new Error('API Key 保存与恢复失败，请保留原密钥文件并检查磁盘权限');
      }
      throw new Error('API Key 未能完整保存，原密钥已保留。请检查磁盘空间与文件权限。');
    }
  }
  migrateLegacy(ciphertext) {
    if (this.readFailed) throw new Error('原密钥读取异常，未进行迁移');
    try {
      if (!this.systemAvailable()) throw new Error('系统密钥库不可用');
      const key = validateApiKey(this.safeStorage.decryptString(Buffer.from(ciphertext, 'base64')));
      return this.save(key);
    } catch {
      this.readFailed = true;
      throw new Error('旧版 API Key 无法安全迁移，原配置已保留。请恢复系统密钥库后重启。');
    }
  }
  status() {
    if (this.readFailed) return '密钥读取异常，原文件已保留';
    if (this.method === 'system') return 'API Key 已由系统加密保护并保存，重启后自动读取';
    if (this.method === 'local-aes-gcm') return 'API Key 已在本机加密保存，重启后自动读取';
    return '尚未保存 API Key';
  }
}

module.exports = {SecretStore, atomicWrite};
