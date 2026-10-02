'use strict';

// Uses only Node built-ins. The same file is used locally and on every CI runner.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Release version must be a stable x.y.z version.');
const prefix = `WhaleRice-${pkg.version}`;
const defaultTag = `v${pkg.version}`;
const args = process.argv.slice(2);
const frames = ['idle-full.png', 'idle-half.png', 'idle-low.png', 'idle-empty.png',
  'eat-01.png', 'eat-02.png', 'eat-02b.png', 'eat-03.png', 'eat-03b.png', 'eat-04.png', 'eat-05.png'];
const platforms = { windows: ['portable.exe', 'setup.exe'], macos: ['dmg', 'zip'], linux: ['AppImage', 'deb'] };

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value after ${name}`);
  return args[index + 1];
}

function installerNames(platform, arch) {
  if (!platforms[platform] || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported platform or architecture.');
  return platforms[platform].map(ext => platform === 'windows'
    ? `${prefix}-${platform}-${arch}-${ext}` : `${prefix}-${platform}-${arch}.${ext}`);
}

const allInstallers = Object.keys(platforms).flatMap(platform =>
  ['x64', 'arm64'].flatMap(arch => installerNames(platform, arch)));

function requireFiles(directory, names) {
  for (const name of names) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`Invalid release file: ${name}`);
  }
}

function verifyBuild(directory, platform, arch) {
  const names = installerNames(platform, arch);
  if (platform === 'linux' && arch === 'x64') {
    // electron-builder uses target-specific arch spellings for AppImage and DEB.
    const aliases = [`${prefix}-linux-x86_64.AppImage`, `${prefix}-linux-amd64.deb`];
    const renames = [];
    for (let index = 0; index < names.length; index++) {
      const canonical = path.join(directory, names[index]);
      const alias = path.join(directory, aliases[index]);
      const canonicalExists = fs.existsSync(canonical);
      const aliasExists = fs.existsSync(alias);
      // Check lstat as well so broken symlinks cannot be mistaken for absent files.
      const entryExists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
      const hasCanonical = canonicalExists || entryExists(canonical);
      const hasAlias = aliasExists || entryExists(alias);
      if (hasCanonical && hasAlias) throw new Error(`Conflicting Linux package names; refusing to overwrite ${names[index]}.`);
      requireFiles(directory, [hasCanonical ? names[index] : aliases[index]]);
      if (!hasCanonical) renames.push({ from: alias, to: canonical });
    }
    // Validate the entire pair before making any changes.
    for (const rename of renames) {
      fs.renameSync(rename.from, rename.to);
      console.log(`Normalized ${path.basename(rename.from)} to ${path.basename(rename.to)}`);
    }
  }
  requireFiles(directory, names);
  console.log(`Verified ${names.join(', ')}`);
}

function walk(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Source archive refuses symbolic links: ${relative}`);
  if (stat.isFile()) return [relative.split(path.sep).join('/')];
  if (!stat.isDirectory()) throw new Error(`Unsupported source file: ${relative}`);
  return fs.readdirSync(absolute).sort().filter(name => name !== '.DS_Store')
    .flatMap(name => walk(path.join(relative, name)));
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(data) {
  let result = 0xffffffff;
  for (const byte of data) result = crcTable[(result ^ byte) & 0xff] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}

function zipFiles(destination, files) {
  const local = [], central = [];
  let offset = 0;
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (file.name.startsWith('/') || file.name.includes('..') || file.name.includes('\\')) throw new Error('Unsafe ZIP entry name.');
    const name = Buffer.from(file.name, 'utf8');
    const data = fs.readFileSync(file.source);
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    if (data.length >= 0xffffffff || compressed.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('ZIP64 is required.');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8
    header.writeUInt16LE(8, 8); // DEFLATE
    header.writeUInt16LE(33, 12); // 1980-01-01, reproducible timestamp
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x314, 4); // Unix metadata, ZIP 2.0
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE((0o100644 * 65536) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  if (files.length >= 65535) throw new Error('Too many ZIP entries.');
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(destination, Buffer.concat([...local, directory, end]));
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function metadata() {
  const tag = process.env.REQUESTED_TAG || process.env.EVENT_TAG || defaultTag;
  if (tag !== defaultTag) throw new Error(`Tag ${tag} does not match package version ${defaultTag}.`);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const existing = spawnSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: root, encoding: 'utf8' });
  if (existing.status === 0 && existing.stdout.trim() !== sha) throw new Error(`${tag} already points to another source commit.`);
  if (!process.env.GITHUB_OUTPUT) throw new Error('Metadata mode requires GITHUB_OUTPUT.');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\nsha=${sha}\n`);
  console.log(`Release ${tag} from ${sha}`);
}

function prepare() {
  const archivesOnly = args.includes('--archives-only');
  const output = path.resolve(root, option('--output', 'release-assets'));
  const binaries = path.resolve(root, option('--binaries', 'release'));
  fs.mkdirSync(output, { recursive: true });
  if (!archivesOnly) {
    requireFiles(binaries, allInstallers);
    for (const name of allInstallers) {
      if (binaries !== output) fs.copyFileSync(path.join(binaries, name), path.join(output, name));
    }
  }
  // An explicit allowlist keeps build caches, user data and API keys out of source archives.
  const sourceRoots = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore', '.gitattributes',
    'LICENSE', 'README.md', 'ASSETS.md', 'main.cjs', 'preload.cjs', 'lib', 'ui', 'assets', 'test', 'scripts', '.github'];
  const sourceEntries = sourceRoots.flatMap(walk).map(relative => ({
    name: `${prefix}/${relative}`, source: path.join(root, relative),
  }));
  const framesRoot = path.join(root, 'assets', 'frames');
  requireFiles(framesRoot, [...frames, 'generation.json']);
  const frameEntries = [...frames, 'generation.json'].map(name => ({
    name: `frames/${name}`, source: path.join(framesRoot, name),
  }));
  frameEntries.push({ name: 'ASSETS.md', source: path.join(root, 'ASSETS.md') });
  const sourceName = `${prefix}-source.zip`, framesName = `${prefix}-frames.zip`;
  zipFiles(path.join(output, sourceName), sourceEntries);
  zipFiles(path.join(output, framesName), frameEntries);
  const names = [...(archivesOnly ? [] : allInstallers), sourceName, framesName].sort();
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), names.map(name => `${sha256(path.join(output, name))}  ${name}`).join('\n') + '\n');
  fs.writeFileSync(path.join(output, 'release-notes.md'), `鲸鱼娘的饭碗 ${pkg.version}\n\n` +
    '挂件大小支持拖动滑块即时调整、± 按钮和自动保存；保留单张透明 PNG 的普通表情吃饭动作。\n\n' +
    '- Windows：x64 / arm64 的便携 EXE 和当前用户安装版 setup EXE。\n' +
    '- macOS：Intel x64 / Apple Silicon arm64 的 DMG 与应用 ZIP。\n' +
    '- Linux：x64 / arm64 的 AppImage 与 DEB。\n' +
    '- source.zip 含完整源码、图片资源、锁文件和构建流程。frames.zip 含 11 张运行时透明 PNG、生成提示词和素材记录。\n' +
    '- SHA256SUMS.txt 提供全部安装包及资源 ZIP 的 SHA-256 校验值。\n\n' +
    'Windows 及 macOS 包未使用开发者签名证书或 macOS 公证。Linux AppImage 下载后需赋予执行权限；Linux 桌面环境可能限制透明、置顶和窗口定位。\n');
  console.log(`Prepared ${names.length + 1} assets in ${output}; source contains ${sourceEntries.length} files, frames contains ${frames.length} PNGs.`);
}

function gh(args, optional = false) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (optional && /HTTP 404|release not found/i.test(result.stderr)) return null;
    throw new Error(result.stderr.trim() || `gh exited with code ${result.status}`);
  }
  return result.stdout.trim();
}

function publish(directory) {
  const output = path.resolve(root, directory);
  const tag = process.env.RELEASE_TAG, sha = process.env.RELEASE_SHA;
  const repo = process.env.GH_REPO;
  if (tag !== defaultTag || !/^[a-f0-9]{40,64}$/.test(sha || '') || !/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Invalid release tag, commit or repository.');
  const names = [...allInstallers, `${prefix}-source.zip`, `${prefix}-frames.zip`, 'SHA256SUMS.txt'];
  requireFiles(output, [...names, 'release-notes.md']);
  const checksums = new Map(fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error('Invalid SHA256 manifest.');
    return [match[2], match[1]];
  }));
  for (const name of names.filter(name => name !== 'SHA256SUMS.txt')) {
    if (checksums.get(name) !== sha256(path.join(output, name))) throw new Error(`Checksum mismatch: ${name}`);
  }
  // Refuse to attach binaries to a tag that points at a different commit.
  const refText = gh(['api', `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`], true);
  if (refText) {
    let object = JSON.parse(refText).object;
    for (let depth = 0; object.type === 'tag' && depth < 10; depth++) object = JSON.parse(gh(['api', `repos/${repo}/git/tags/${object.sha}`])).object;
    if (object.type !== 'commit' || object.sha !== sha) throw new Error('Remote release tag points at another commit.');
  }
  const existing = gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft'], true);
  if (!existing) gh(['release', 'create', tag, '--repo', repo, '--target', sha, '--draft', '--title', `Whale Rice ${pkg.version}`, '--notes-file', path.join(output, 'release-notes.md')]);
  gh(['release', 'upload', tag, '--repo', repo, '--clobber', ...names.map(name => path.join(output, name))]);
  gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest', '--title', `Whale Rice ${pkg.version}`, '--notes-file', path.join(output, 'release-notes.md')]);
  console.log(`Published https://github.com/${repo}/releases/tag/${tag} with ${names.length} assets.`);
}

try {
  if (args.includes('--metadata')) metadata();
  else if (args.includes('--verify-build')) {
    const index = args.indexOf('--verify-build');
    verifyBuild(path.join(root, 'release'), args[index + 1], args[index + 2]);
  } else if (args.includes('--publish')) publish(option('--publish'));
  else prepare();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
