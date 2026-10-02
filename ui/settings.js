'use strict';

const $ = selector => document.querySelector(selector);
let currentState;
let initialized = false;
let saving = false;
let importing = false;
let notice = '';
let noticeIsError = false;
let scaleTimer = null;
let pendingScale = null;
let scaleRequest = null;
let scaleRevision = 0;
let scaleDragging = false;

function renderFeedback() {
  const error = currentState?.error;
  const text = noticeIsError ? notice : currentState?.status === 'error' && error ? error : notice;
  $('#feedback').textContent = text || (currentState?.busy ? '正在查询余额…' : '');
  $('#feedback').classList.toggle('is-error', noticeIsError || (currentState?.status === 'error' && Boolean(error)));
}

function feedback(text, error = false) {
  notice = text;
  noticeIsError = error;
  renderFeedback();
}

function scaleLabel() {
  const input = $('#ui-scale');
  $('#scale-value').value = `${Math.round(Number(input.value) * 100)}%`;
  const fraction = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--range-fill', `${fraction * 100}%`);
  $('#scale-down').disabled = Number(input.value) <= Number(input.min);
  $('#scale-up').disabled = Number(input.value) >= Number(input.max);
}

function scaleNote(text = '拖动立即生效 · 自动保存', error = false) {
  $('#scale-note').textContent = text;
  $('#scale-note').classList.toggle('is-error', error);
}

function scaleIsActive() {
  return scaleDragging || scaleTimer !== null || pendingScale !== null || scaleRequest !== null || saving;
}

function syncScale(state) {
  const scale = Number(state?.config?.uiScale);
  $('#ui-scale').value = Number.isFinite(scale) ? Math.min(1.6, Math.max(0.7, scale)) : 1;
  scaleLabel();
}

function queueScale(value) {
  const scale = Math.min(1.6, Math.max(0.7, Math.round(Number(value) * 100) / 100));
  $('#ui-scale').value = scale;
  scaleLabel();
  pendingScale = {value: scale, revision: ++scaleRevision};
  scaleNote('拖动立即生效 · 正在自动保存…');
  clearTimeout(scaleTimer);
  scaleTimer = setTimeout(() => {
    scaleTimer = null;
    void flushScale();
  }, 150);
}

function flushScale() {
  if (scaleRequest) return scaleRequest;
  if (!pendingScale) return Promise.resolve();
  const job = pendingScale;
  pendingScale = null;
  scaleRequest = Promise.resolve().then(async () => {
    try {
      const result = await window.whale.setScale(job.value);
      if (result?.ok === false) throw new Error(result.error || '大小保存失败，请重试。');
      const state = result?.state || (result?.config ? result : null);
      if (state) update(state);
      if (job.revision === scaleRevision) scaleNote('拖动立即生效 · 大小已自动保存');
    } catch (error) {
      if (job.revision === scaleRevision) scaleNote(error?.message || '大小保存失败，请重试。', true);
    }
  }).finally(() => {
    scaleRequest = null;
    if (pendingScale && scaleTimer === null) void flushScale();
    else if (!scaleIsActive() && currentState) syncScale(currentState);
  });
  return scaleRequest;
}

async function finishPendingScale() {
  clearTimeout(scaleTimer);
  scaleTimer = null;
  while (pendingScale || scaleRequest) await flushScale();
}

function finishScaleDrag() {
  scaleDragging = false;
  if (!scaleIsActive() && currentState) syncScale(currentState);
}

function update(state) {
  if (!state) return;
  currentState = state;
  $('#key-status').textContent = state.hasKey ? '已保存' : '未导入';
  $('#key-status').classList.toggle('is-saved', Boolean(state.hasKey));
  $('#api-key').placeholder = state.hasKey ? '留空保留已保存的密钥' : '粘贴 sk-…';

  const storage = String(state.storageStatus || '');
  const temporary = /^(session|memory|temporary|unavailable)$/i.test(storage);
  if (temporary && state.hasKey) {
    $('#key-status').textContent = '尚未持久保存';
    $('#key-status').classList.remove('is-saved');
    $('#key-note').textContent = '密钥暂未写入本机，请重新保存。';
  } else {
    $('#key-note').textContent = state.hasKey
      ? '密钥已保存在本机，重启后自动恢复。\n留空即可保留，不会回显已保存的密钥。'
      : '密钥保存在本机，重启后自动恢复。\n已保存的密钥不会显示在输入框里。';
  }

  if (!initialized || !scaleIsActive()) syncScale(state);
  initialized = true;
  $('#settings-fields').disabled = saving || importing;
  renderFeedback();
}

$('#ui-scale').addEventListener('input', () => {
  queueScale($('#ui-scale').value);
});
$('#ui-scale').addEventListener('pointerdown', () => {scaleDragging = true;});
$('#ui-scale').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) scaleDragging = true;
});
$('#ui-scale').addEventListener('keyup', finishScaleDrag);
$('#ui-scale').addEventListener('blur', finishScaleDrag);
document.addEventListener('pointerup', finishScaleDrag);
document.addEventListener('pointercancel', finishScaleDrag);
$('#scale-down').addEventListener('click', () => queueScale(Number($('#ui-scale').value) - 0.05));
$('#scale-up').addEventListener('click', () => queueScale(Number($('#ui-scale').value) + 0.05));
$('#api-key').addEventListener('input', () => {
  if (notice && !noticeIsError) feedback('');
});

$('#import-key').addEventListener('click', async () => {
  importing = true;
  $('#settings-fields').disabled = true;
  try {
    const imported = await window.whale.importKeyFile();
    if (imported?.error) throw new Error(imported.error);
    const text = typeof imported === 'string' ? imported : imported?.canceled ? null : imported?.apiKey;
    if (text !== null && text !== undefined) {
      const key = String(text).trim();
      if (!key) feedback('文件里没有找到密钥。', true);
      else {
        $('#api-key').value = key;
        feedback('密钥已导入，点击保存即可。');
      }
    }
  } catch (error) {
    feedback(error?.message || '读取文件失败，请重试。', true);
  } finally {
    importing = false;
    $('#settings-fields').disabled = saving;
  }
});

$('#config-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || importing || !initialized) return;
  const fields = {uiScale: Number($('#ui-scale').value), apiKey: $('#api-key').value.trim()};
  saving = true;
  $('#settings-fields').disabled = true;
  $('#save').textContent = '正在保存…';
  feedback('');
  try {
    await finishPendingScale();
    const result = await window.whale.save(fields);
    if (!result?.ok) feedback(result?.error || '保存失败，请重试。', true);
    else {
      $('#api-key').value = '';
      if (result.state) update(result.state);
      else update(await window.whale.state());
      feedback('设置已保存。');
      scaleNote('拖动立即生效 · 大小已自动保存');
    }
  } catch (error) {
    feedback(error?.message || '保存失败，请重试。', true);
  } finally {
    saving = false;
    $('#settings-fields').disabled = false;
    $('#save').textContent = '保存设置';
    if (!scaleIsActive() && currentState) syncScale(currentState);
  }
});

window.whale.subscribe(update);
window.whale.state().then(update).catch(() => {
  feedback('设置读取失败，请重新打开设置。', true);
});
