const {app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, safeStorage, screen, dialog} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {validateSettings, validateUiScale, validateApiKey, transition} = require('./lib/logic.js');
const {fetchBalance} = require('./lib/balance.cjs');
const {SecretStore, atomicWrite} = require('./lib/storage.cjs');
// Development checks use an isolated profile; the real user profile is untouched.
if (!app.isPackaged && process.env.WHALE_RICE_TEST_PROFILE) app.setPath('userData', process.env.WHALE_RICE_TEST_PROFILE);
const defaults = {uiScale: 1};
let config = {...defaults}, key = '', widget, settings, tray, timer, positionTimer, epoch = 0, activeRequest, quitting = false;
let state = {balance: null, updatedAt: null, status: 'unconfigured', error: '', motion: 'none', motionId: 0, busy: false};
let configPath, secretStore, configReadFailed = false, startupError = '', showingContextMenu = false;
let changingScale = false, settingsWriteQueue = Promise.resolve();
function snapshot() {
  return {...state, config: {uiScale: config.uiScale}, hasKey: !!key, storageStatus: secretStore ? secretStore.status() : '尚未保存 API Key'};
}
function publish() {for (const win of [widget, settings]) if (win && !win.isDestroyed()) win.webContents.send('update', snapshot());}
function writeConfig(next) {
  if (configReadFailed) throw new Error('原设置文件读取异常，已保留。请检查文件权限或修复文件后重启。');
  if (secretStore?.readFailed && config.encryptedKey) throw new Error('旧版密钥读取异常，原配置已保留。请恢复系统密钥库后重启。');
  atomicWrite(configPath, JSON.stringify(next, null, 2));
}
function rememberPosition() {
  if (changingScale) return;
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    if (!widget || widget.isDestroyed()) return;
    const [x, y] = widget.getPosition(); config.position = {x, y};
    try {writeConfig(config);} catch { /* A temporary position-save failure must not alter the API Key. */ }
  }, 350);
}
function updateBalance(balance) {
  state.motion = transition(state.balance, balance); state.motionId++;
  state.balance = balance; state.updatedAt = Date.now(); state.status = 'live'; state.error = ''; publish();
}
async function refresh() {
  if (!key) {
    state.status = startupError ? 'error' : 'unconfigured';
    state.error = startupError || '右键鲸鱼娘进入设置，导入 DeepSeek API Key'; publish(); return snapshot();
  }
  if (activeRequest?.epoch === epoch) return activeRequest.promise;
  const requestEpoch = epoch;
  state.busy = true; if (!state.balance) state.status = 'loading'; publish();
  const promise = (async () => {
    try {
      const balance = await fetchBalance(key);
      if (requestEpoch === epoch) updateBalance(balance);
    } catch (error) {
      if (requestEpoch === epoch) {
        state.status = 'error';
        state.error = ['TimeoutError', 'AbortError'].includes(error.name) ? '查询超时，稍后自动重试' : error instanceof TypeError ? '网络连接失败，稍后自动重试' : error.message;
      }
    } finally {
      if (requestEpoch === epoch) {state.busy = false; activeRequest = null; publish();}
    }
    return snapshot();
  })();
  activeRequest = {epoch: requestEpoch, promise}; return promise;
}
function beginPolling() {
  clearTimeout(timer); const generation = epoch;
  const cycle = async () => {
    await refresh();
    if (generation === epoch && key && !quitting) timer = setTimeout(cycle, 60000);
  };
  if (key) void cycle(); else void refresh();
}
function createWindow(file, options) {
  const win = new BrowserWindow({...options, show: false, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'ui', file));
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.once('ready-to-show', () => win.show()); return win;
}
function openSettings() {
  if (settings && !settings.isDestroyed()) {settings.show(); settings.focus(); return;}
  settings = createWindow('settings.html', {width: 460, height: 470, minWidth: 440, minHeight: 430, backgroundColor: '#f4f7fc', title: '鲸鱼娘的饭碗 · 设置', autoHideMenuBar: true});
  settings.on('closed', () => {settings = null;});
}
function widgetSize(scale = config.uiScale) {return {width: Math.round(300 * scale), height: Math.round(390 * scale)};}
function clampPosition(position, size) {
  const displays = screen.getAllDisplays();
  let area = displays.find(({workArea: a}) => position.x >= a.x && position.x < a.x + a.width && position.y >= a.y && position.y < a.y + a.height)?.workArea;
  area ||= screen.getPrimaryDisplay().workArea;
  return {x: Math.round(Math.min(Math.max(position.x, area.x), area.x + Math.max(0, area.width - size.width))), y: Math.round(Math.min(Math.max(position.y, area.y), area.y + Math.max(0, area.height - size.height)))};
}
function resizeWidget(scale = config.uiScale) {
  if (!widget || widget.isDestroyed()) throw new Error('鲸鱼娘窗口不可用，请重新启动软件');
  const size = widgetSize(scale), [x, y] = widget.getPosition();
  // setSize may be ignored by a fixed window's native min/max constraints on Windows.
  // setBounds updates those constraints without toggling the transparent window's resizability.
  widget.setBounds({...size, ...clampPosition({x, y}, size)}, false);
  const position = widget.getPosition(); return {x: position[0], y: position[1]};
}
async function confirmWidgetSize(scale) {
  const size = widgetSize(scale);
  const matches = () => {
    if (!widget || widget.isDestroyed()) return false;
    const [width, height] = widget.getContentSize();
    // Native DPI conversion may round a frameless Windows window by one DIP.
    return Math.abs(width - size.width) <= 2 && Math.abs(height - size.height) <= 2;
  };
  if (matches()) return;
  await new Promise(resolve => {
    const finish = () => {clearTimeout(timeout); widget?.removeListener('resize', resized); resolve();};
    const resized = () => {if (matches()) finish();};
    const timeout = setTimeout(finish, 350);
    widget?.on('resize', resized);
  });
  if (!matches()) throw new Error('窗口大小未能修改，请重试或重新启动软件');
}
function enqueueSettingsWrite(work) {
  const result = settingsWriteQueue.then(work, work);
  settingsWriteQueue = result.catch(() => {});
  return result;
}
async function applyScale(value) {
  const previous = {...config};
  try {
    const uiScale = validateUiScale(value), next = {...config, uiScale};
    changingScale = true; clearTimeout(positionTimer);
    next.position = resizeWidget(uiScale);
    await confirmWidgetSize(uiScale);
    writeConfig(next); config = next;
    publish(); return {ok: true, state: snapshot()};
  } catch (error) {
    try {resizeWidget(previous.uiScale);} catch {}
    publish();
    return {ok: false, error: error.code ? '界面大小保存失败，请检查磁盘空间与文件权限' : error.message, state: snapshot()};
  } finally {changingScale = false; clearTimeout(positionTimer);}
}
function setScale(value) {return enqueueSettingsWrite(() => applyScale(value));}
function contextMenu() {
  if (showingContextMenu || !widget || widget.isDestroyed()) return;
  showingContextMenu = true;
  Menu.buildFromTemplate([{label: '设置', click: openSettings}, {label: '刷新余额', enabled: !!key, click: () => void refresh()}, {type: 'separator'}, {label: '退出', click: () => app.quit()}]).popup({window: widget, callback: () => {showingContextMenu = false;}});
}
function createWidget() {
  const area = screen.getPrimaryDisplay().workArea, size = widgetSize();
  const savedPosition = Number.isFinite(config.position?.x) && Number.isFinite(config.position?.y) ? config.position : {x: area.x + area.width - size.width - 30, y: area.y + area.height - size.height - 20};
  widget = createWindow('widget.html', {...size, ...clampPosition(savedPosition, size), frame: false, transparent: true, resizable: false, maximizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, title: '鲸鱼娘的饭碗'});
  // Normalize the fixed frameless window after native construction/menu removal;
  // Windows may otherwise add a few DIPs to a restored size at high display scaling.
  config.position = resizeWidget();
  widget.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
  widget.on('close', event => {if (!quitting) {event.preventDefault(); widget.hide();}});
  widget.on('moved', rememberPosition);
  widget.webContents.on('context-menu', contextMenu);
}
function register(name, handler) {
  ipcMain.handle(name, (event, ...args) => {
    const allowed = [widget, settings].filter(win => win && !win.isDestroyed());
    if (!allowed.some(win => win.webContents === event.sender) || !['widget.html', 'settings.html'].some(file => event.senderFrame.url === pathToFileURL(path.join(__dirname, 'ui', file)).href)) throw new Error('请求来源无效');
    return handler(...args);
  });
}
async function importKeyFile() {
  const result = await dialog.showOpenDialog(settings || widget, {title: '导入 DeepSeek API Key', properties: ['openFile'], filters: [{name: 'API Key 文本文件', extensions: ['txt', 'key']}, {name: '所有文件', extensions: ['*']}]});
  if (result.canceled || !result.filePaths.length) return {canceled: true};
  try {
    const file = result.filePaths[0], stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 4096) throw new Error('请选择仅包含 API Key 的小型文本文件');
    return {canceled: false, apiKey: validateApiKey(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))};
  } catch (error) {return {canceled: false, error: error.code ? 'API Key 文件无法读取，请检查文件权限' : error.message};}
}
async function saveSettings(input) {
  let persistedKey = '';
  try {
    const next = {...config, ...validateSettings(input)};
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('API Key 格式不正确');
    const newKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? validateApiKey(input.apiKey) : '';
    // An unreadable legacy settings file is never replaced, even while saving a new Key.
    if (configReadFailed) throw new Error('原设置文件读取异常，已保留。请修复后重启再保存。');
    if (secretStore.readFailed && newKey) throw new Error('为保护原密钥，读取异常时禁止覆盖。请恢复原密钥存储后重启。');
    // Key writes include a read-back check. Only verified persistent keys enter memory.
    if (newKey) {persistedKey = secretStore.save(newKey); delete next.encryptedKey;}
    writeConfig(next); config = next;
    config.position = resizeWidget(); writeConfig(config);
    if (newKey) {
      key = persistedKey; startupError = '';
      epoch++; clearTimeout(timer); activeRequest = null;
      state = {...state, balance: null, updatedAt: null, error: '', motion: 'none', busy: false, status: 'loading'};
      publish(); beginPolling();
    } else publish();
    return {ok: true, state: snapshot()};
  } catch (error) {
    if (persistedKey) {
      // A successfully persisted Key remains usable even if an unrelated size save fails.
      key = persistedKey; startupError = ''; epoch++; clearTimeout(timer); activeRequest = null;
      state = {...state, balance: null, updatedAt: null, error: '', motion: 'none', busy: false, status: 'loading'};
      publish(); beginPolling();
      return {ok: false, error: 'API Key 已加密保存并可在重启后读取，但界面大小保存失败。请检查磁盘空间与文件权限。', state: snapshot()};
    }
    publish(); return {ok: false, error: error.code ? '设置保存失败，请检查磁盘空间与文件权限' : error.message, state: snapshot()};
  }
}
function save(input) {return enqueueSettingsWrite(() => saveSettings(input));}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (widget) widget.show(); openSettings();});
  app.whenReady().then(() => {
    configPath = path.join(app.getPath('userData'), 'settings.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    try {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = {...validateSettings(saved)};
      if (saved.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y)) config.position = saved.position;
      if (typeof saved.encryptedKey === 'string' && saved.encryptedKey) config.encryptedKey = saved.encryptedKey;
    } catch (error) {
      if (error.code !== 'ENOENT') {configReadFailed = true; startupError = '原设置文件无法读取，已保留。请检查文件权限或修复后重启。';}
      config = {...defaults};
    }
    secretStore = new SecretStore(app.getPath('userData'), safeStorage);
    try {
      key = secretStore.load();
      if (!key && config.encryptedKey) key = secretStore.migrateLegacy(config.encryptedKey);
      if (key && config.encryptedKey) {delete config.encryptedKey; writeConfig(config);}
    } catch (error) {startupError = error.message;}
    state.error = startupError;
    register('state', snapshot);
    register('settings', openSettings);
    register('contextMenu', contextMenu);
    register('importKeyFile', importKeyFile);
    register('refresh', refresh);
    register('save', save);
    register('setScale', setScale);
    createWidget();
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'whale.png')).resize({width: 24, height: 24}));
      tray.setToolTip('鲸鱼娘的饭碗 · DeepSeek 余额');
      tray.setContextMenu(Menu.buildFromTemplate([{label: '显示鲸鱼娘', click: () => widget.show()}, {label: '设置', click: openSettings}, {label: '刷新余额', click: () => void refresh()}, {type: 'separator'}, {label: '退出', click: () => app.quit()}]));
      tray.on('click', () => widget.show());
    } catch { /* The widget context menu remains available without a Linux tray host. */ }
    beginPolling();
    if (!key || startupError) openSettings();
    app.on('activate', () => {widget.show(); if (!key) openSettings();});
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true; epoch++; clearTimeout(timer); clearTimeout(positionTimer);
    if (widget && !widget.isDestroyed()) {
      const [x, y] = widget.getPosition(); config.position = {x, y};
      try {writeConfig(config);} catch {}
    }
  });
}
