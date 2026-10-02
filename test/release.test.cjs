'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const releaseScript = fs.readFileSync(path.join(root, 'scripts', 'prepare-release.cjs'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const prefix = `WhaleRice-${version}-linux-`;
const appAlias = `${prefix}x86_64.AppImage`, debAlias = `${prefix}amd64.deb`;
const appCanonical = `${prefix}x64.AppImage`, debCanonical = `${prefix}x64.deb`;

function fixture(t, contents, arch = 'x64', simulatedSymlink) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'whale-rice-release-'));
  t.after(() => {
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), temporaryRoot);
    assert(path.basename(absolute).startsWith('whale-rice-release-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const release = path.join(directory, 'release');
  fs.mkdirSync(release);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }));
  for (const [name, data] of Object.entries(contents)) fs.writeFileSync(path.join(release, name), data);
  const errors = [];
  const fakeProcess = { argv: ['node', 'prepare-release.cjs', '--verify-build', 'linux', arch], env: {}, exitCode: 0 };
  const fakeFs = simulatedSymlink ? {
    ...fs,
    existsSync(file) { return path.basename(file) === simulatedSymlink ? false : fs.existsSync(file); },
    lstatSync(file) {
      return path.basename(file) === simulatedSymlink
        ? { isFile: () => false, isSymbolicLink: () => true, size: 100 }
        : fs.lstatSync(file);
    },
  } : fs;
  vm.runInNewContext(releaseScript, {
    require: name => name === 'node:fs' ? fakeFs : require(name),
    __dirname: path.join(directory, 'scripts'), process: fakeProcess, Buffer, Uint32Array,
    console: { log() {}, error(message) { errors.push(message); } },
  });
  return { release, errors, status: fakeProcess.exitCode };
}

test('Linux x64 AppImage and DEB aliases are normalized without changing bytes', t => {
  const result = fixture(t, { [appAlias]: 'app-image-bytes', [debAlias]: 'deb-bytes' });
  assert.equal(result.status, 0, result.errors.join('\n'));
  assert.equal(fs.readFileSync(path.join(result.release, appCanonical), 'utf8'), 'app-image-bytes');
  assert.equal(fs.readFileSync(path.join(result.release, debCanonical), 'utf8'), 'deb-bytes');
  assert(!fs.existsSync(path.join(result.release, appAlias)));
  assert(!fs.existsSync(path.join(result.release, debAlias)));
});

test('canonical Linux x64 and arm64 names remain intact', t => {
  const x64 = fixture(t, { [appCanonical]: 'app', [debCanonical]: 'deb' });
  assert.equal(x64.status, 0);
  assert.deepEqual(fs.readdirSync(x64.release).sort(), [appCanonical, debCanonical].sort());
  const armNames = [`${prefix}arm64.AppImage`, `${prefix}arm64.deb`];
  const arm = fixture(t, { [armNames[0]]: 'app', [armNames[1]]: 'deb' }, 'arm64');
  assert.equal(arm.status, 0);
  assert.deepEqual(fs.readdirSync(arm.release).sort(), armNames.sort());
});

test('canonical and alias collisions refuse to overwrite either package', t => {
  const result = fixture(t, { [appCanonical]: 'preserve', [appAlias]: 'alias', [debAlias]: 'deb' });
  assert.equal(result.status, 1);
  assert.match(result.errors.join('\n'), /refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(result.release, appCanonical), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(result.release, appAlias), 'utf8'), 'alias');
});

test('empty or missing package prevents all alias renaming', t => {
  for (const contents of [{ [appAlias]: 'app', [debAlias]: '' }, { [appAlias]: 'app' }]) {
    const result = fixture(t, contents);
    assert.equal(result.status, 1);
    assert(fs.existsSync(path.join(result.release, appAlias)));
    assert(!fs.existsSync(path.join(result.release, appCanonical)));
  }
});

test('aliases and canonical packages reject symbolic links, including broken links', t => {
  for (const symbolicName of [appAlias, appCanonical]) {
    const result = fixture(t, { [debAlias]: 'deb' }, 'x64', symbolicName);
    assert.equal(result.status, 1);
    assert.match(result.errors.join('\n'), /Invalid release file/);
    assert(fs.existsSync(path.join(result.release, debAlias)));
  }
});
