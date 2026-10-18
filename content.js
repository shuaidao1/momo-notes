// Momo Notes 内容脚本
// 职责：在宿主页面注入便利贴层（Shadow DOM），负责创建 / 编辑 / 拖动 / 删除 / 换色，
//       并按页面 URL 将数据读写到 chrome.storage.local，实现页面隔离与刷新恢复。
//
// 安全约定：用户输入一律通过 textarea.value / textContent 处理，绝不使用 innerHTML。

(function () {
  'use strict';

  // —— 常量 ——
  const STORAGE_PREFIX = 'momoNote:';   // 存储键前缀（每个页面一个独立键，避免跨页写入竞争）
  const DEFAULT_COLOR = 'pink';
  const NOTE_WIDTH = 224;
  const NOTE_HEIGHT = 224;
  const KEEP_VISIBLE_X = 48;            // 水平方向至少保留可见的像素
  const KEEP_VISIBLE_Y = 40;            // 垂直方向至少保留可见的像素（标题栏高度）
  const SAVE_DEBOUNCE = 400;            // 输入/拖动保存的防抖毫秒数
  const CONFIRM_TIMEOUT = 3000;         // 删除确认的自动复位时间

  const COLORS = ['pink', 'yellow', 'mint', 'lavender'];
  const COLOR_NAMES = { pink: '粉色', yellow: '奶黄', mint: '薄荷绿', lavender: '薰衣草紫' };

  // 兜底样式：仅在 fetch content.css 失败时启用，保证便签仍可用
  const FALLBACK_CSS = [
    '.momo-note{position:fixed;width:224px;height:224px;display:flex;flex-direction:column;background:#FFE4EF;border:1px solid #F9A8D4;border-radius:16px;color:#4A2B3A;font-family:sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.15);overflow:hidden;box-sizing:border-box}',
    '.momo-note__header{flex:0 0 auto;display:flex;align-items:center;gap:6px;height:40px;padding:0 10px;background:#FFD3E5;cursor:grab;user-select:none}',
    '.momo-note__colors{display:flex;gap:6px;margin-left:auto}',
    '.momo-note__color{width:16px;height:16px;border-radius:50%;border:1px solid rgba(0,0,0,.08);cursor:pointer;padding:0}',
    '.momo-note__color--pink{background:#F9A8D4}.momo-note__color--yellow{background:#FDE68A}.momo-note__color--mint{background:#A7E3C2}.momo-note__color--lavender{background:#CDB4F6}',
    '.momo-note__btn{border:none;cursor:pointer;font-size:12px;border-radius:8px}',
    '.momo-note__delete{width:24px;height:24px;background:rgba(255,255,255,.6)}',
    '.momo-note__cancel{display:none;height:24px;padding:0 8px;background:rgba(255,255,255,.6)}',
    '.momo-note.confirming .momo-note__cancel{display:inline-flex}',
    '.momo-note.confirming .momo-note__delete{width:auto;padding:0 8px;background:#E11D48;color:#fff}',
    '.momo-note__body{flex:1;border:none;outline:none;resize:none;background:transparent;padding:12px;font-size:14px;line-height:1.6;font-family:inherit}'
  ].join('');

  // —— 运行状态 ——
  let pageKey = null;          // 当前页面的存储键（origin + pathname）
  let notes = new Map();       // id -> 便签 DOM 元素
  let zTop = 0;                // 递增的 z-index 计数
  let visible = true;          // 是否显示便利贴
  let host = null;             // 宿主容器（附加到 document）
  let shadow = null;           // Shadow DOM root
  let layer = null;            // Shadow 内的便签层
  let saveTimer = null;        // 保存防抖定时器

  // —— 工具函数 ——
  function storageKey() {
    return STORAGE_PREFIX + pageKey;
  }

  // 以 origin + pathname 作为页面键（去除 query/hash，避免翻页、锚点变化导致便签“消失”）
  function getPageKey() {
    const origin = location.origin || (location.protocol + '//' + location.host);
    let path = location.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return origin + path;
  }

  function genId() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clampX(x, el) {
    const w = el.offsetWidth || NOTE_WIDTH;
    const min = -(w - KEEP_VISIBLE_X);
    const max = window.innerWidth - KEEP_VISIBLE_X;
    return Math.min(max, Math.max(min, x));
  }

  function clampY(y, el) {
    const max = window.innerHeight - KEEP_VISIBLE_Y;
    return Math.min(max, Math.max(0, y));
  }

  function colorOf(el) {
    for (const c of COLORS) {
      if (el.classList.contains('momo-note--' + c)) return c;
    }
    return DEFAULT_COLOR;
  }

  // —— 存储 ——
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeData, SAVE_DEBOUNCE);
  }

  function readNoteData(el) {
    return {
      id: el.dataset.id,
      text: el.querySelector('.momo-note__body').value,
      color: colorOf(el),
      x: Math.round(parseFloat(el.style.left) || 0),
      y: Math.round(parseFloat(el.style.top) || 0),
      w: el.offsetWidth || NOTE_WIDTH,
      h: el.offsetHeight || NOTE_HEIGHT,
      z: parseInt(el.style.zIndex, 10) || 0,
      createdAt: Number(el.dataset.createdAt) || Date.now(),
      updatedAt: Date.now()
    };
  }

  function writeData() {
    if (!pageKey) return;
    const arr = [];
    notes.forEach((el) => arr.push(readNoteData(el)));
    const payload = {};
    payload[storageKey()] = { notes: arr, visible, updatedAt: Date.now() };
    try {
      chrome.storage.local.set(payload, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Momo Notes] 保存失败：', chrome.runtime.lastError.message);
        }
      });
    } catch (err) {
      console.warn('[Momo Notes] 保存异常：', err);
    }
  }

  function loadData() {
    const key = storageKey();
    try {
      chrome.storage.local.get(key, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[Momo Notes] 读取失败：', chrome.runtime.lastError.message);
          return;
        }
        const data = res && res[key];
        if (data) {
          visible = data.visible !== false;
          setHostVisible();
          const arr = Array.isArray(data.notes) ? data.notes : [];
          arr.forEach((n) => {
            const el = buildNote(n);
            layer.appendChild(el);
            notes.set(n.id, el);
            zTop = Math.max(zTop, n.z || 0);
          });
        }
      });
    } catch (err) {
      console.warn('[Momo Notes] 读取异常：', err);
    }
  }

  // —— 宿主层与样式注入 ——
  function buildHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'momo-notes-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
    shadow = host.attachShadow({ mode: 'closed' });
    layer = document.createElement('div');
    layer.className = 'momo-layer';
    shadow.appendChild(layer);
    (document.documentElement || document.body).appendChild(host);
  }

  async function injectStyle() {
    const style = document.createElement('style');
    let css = '';
    try {
      const url = chrome.runtime.getURL('content.css');
      const res = await fetch(url);
      css = await res.text();
    } catch (err) {
      css = FALLBACK_CSS;
    }
    style.textContent = css;
    shadow.appendChild(style);
  }

  function setHostVisible() {
    if (host) host.style.display = visible ? '' : 'none';
  }

  // —— 便签交互 ——
  function bringToFront(el) {
    el.style.zIndex = String(++zTop);
  }

  function buildNote(data) {
    const color = COLORS.includes(data.color) ? data.color : DEFAULT_COLOR;

    const el = document.createElement('div');
    el.className = 'momo-note momo-note--' + color;
    el.dataset.id = data.id;
    el.dataset.createdAt = data.createdAt || Date.now();
    el.style.left = (data.x || 0) + 'px';
    el.style.top = (data.y || 0) + 'px';
    el.style.zIndex = String(data.z || 0);

    // 标题栏（拖动把手）
    const header = document.createElement('div');
    header.className = 'momo-note__header';
    header.title = '按住拖动';

    const grip = document.createElement('span');
    grip.className = 'momo-note__grip';

    // 颜色选择
    const colors = document.createElement('div');
    colors.className = 'momo-note__colors';
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'momo-note__btn momo-note__color momo-note__color--' + c;
      if (c === color) b.classList.add('active');
      b.setAttribute('aria-label', '换为' + COLOR_NAMES[c]);
      b.addEventListener('click', (e) => { e.stopPropagation(); setColor(el, c); });
      colors.appendChild(b);
    });

    // 取消删除
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'momo-note__btn momo-note__cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', (e) => { e.stopPropagation(); exitConfirm(el); });

    // 删除（两次点击确认）
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'momo-note__btn momo-note__delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除便利贴');
    del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(el); });

    header.appendChild(grip);
    header.appendChild(colors);
    header.appendChild(cancel);
    header.appendChild(del);

    // 正文编辑区
    const body = document.createElement('textarea');
    body.className = 'momo-note__body';
    body.value = data.text || '';
    body.placeholder = '写点什么…';
    body.spellcheck = false;
    body.addEventListener('input', () => persist());
    body.addEventListener('blur', () => persist());
    body.addEventListener('focus', () => bringToFront(el));

    el.appendChild(header);
    el.appendChild(body);

    // 拖动（仅标题栏触发）
    header.addEventListener('pointerdown', (e) => startDrag(el, e));
    // 点击便签任意处将其置顶
    el.addEventListener('pointerdown', () => bringToFront(el));

    return el;
  }

  function setColor(el, color) {
    COLORS.forEach((c) => el.classList.remove('momo-note--' + c));
    el.classList.add('momo-note--' + color);
    const dots = el.querySelectorAll('.momo-note__color');
    dots.forEach((d) => d.classList.toggle('active', d.classList.contains('momo-note__color--' + color)));
    persist();
  }

  function onDelete(el) {
    if (!el.classList.contains('confirming')) {
      enterConfirm(el);
      return;
    }
    removeNote(el);
  }

  function enterConfirm(el) {
    el.classList.add('confirming');
    el.querySelector('.momo-note__delete').textContent = '确认删除';
    clearTimeout(el._confirmTimer);
    el._confirmTimer = setTimeout(() => exitConfirm(el), CONFIRM_TIMEOUT);
  }

  function exitConfirm(el) {
    el.classList.remove('confirming');
    const del = el.querySelector('.momo-note__delete');
    if (del) del.textContent = '✕';
    clearTimeout(el._confirmTimer);
  }

  function removeNote(el) {
    clearTimeout(el._confirmTimer);
    el.remove();
    notes.delete(el.dataset.id);
    persist();
  }

  function startDrag(el, e) {
    // 忽略按钮点击与右键
    if (e.button !== 0) return;
    if (e.target.closest('.momo-note__btn')) return;

    e.preventDefault();
    const header = el.querySelector('.momo-note__header');
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = parseFloat(el.style.left) || 0;
    const origY = parseFloat(el.style.top) || 0;

    el.classList.add('dragging');
    bringToFront(el);

    const onMove = (ev) => {
      ev.preventDefault();
      el.style.left = clampX(origX + ev.clientX - startX, el) + 'px';
      el.style.top = clampY(origY + ev.clientY - startY, el) + 'px';
    };
    const onUp = (ev) => {
      try { header.releasePointerCapture(ev.pointerId); } catch (err) {}
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onUp);
      header.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging');
      persist();
    };

    try { header.setPointerCapture(e.pointerId); } catch (err) {}
    header.addEventListener('pointermove', onMove);
    header.addEventListener('pointerup', onUp);
    header.addEventListener('pointercancel', onUp);
  }

  function defaultX() {
    return 40 + (notes.size % 6) * 28;
  }

  function defaultY() {
    return 64 + (notes.size % 6) * 28;
  }

  function createNote(opts) {
    if (!layer) return null;
    const o = opts || {};
    const data = {
      id: genId(),
      text: '',
      color: COLORS.includes(o.color) ? o.color : DEFAULT_COLOR,
      x: defaultX(),
      y: defaultY(),
      w: NOTE_WIDTH,
      h: NOTE_HEIGHT,
      z: ++zTop,
      createdAt: Date.now()
    };
    const el = buildNote(data);
    layer.appendChild(el);
    // 先挂载再钳制（此时才能读到 offsetWidth/Height）
    el.style.left = clampX(data.x, el) + 'px';
    el.style.top = clampY(data.y, el) + 'px';
    notes.set(data.id, el);
    persist();
    // 自动聚焦编辑
    setTimeout(() => {
      const b = el.querySelector('.momo-note__body');
      if (b) b.focus();
    }, 50);
    return el;
  }

  function setVisible(v) {
    visible = v;
    setHostVisible();
    persist();
  }

  // —— 与 Popup 通信 ——
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (!layer) {
      sendResponse({ ok: false, error: 'not-ready' });
      return;
    }
    switch (msg.type) {
      case 'GET_STATE':
        sendResponse({ ok: true, count: notes.size, visible });
        break;
      case 'CREATE_NOTE':
        createNote({ color: msg.color });
        sendResponse({ ok: true, count: notes.size });
        break;
      case 'TOGGLE_NOTES':
        setVisible(!visible);
        sendResponse({ ok: true, visible });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown' });
    }
  });

  // —— 窗口尺寸变化时重新钳制位置 ——
  window.addEventListener('resize', () => {
    notes.forEach((el) => {
      el.style.left = clampX(parseFloat(el.style.left) || 0, el) + 'px';
      el.style.top = clampY(parseFloat(el.style.top) || 0, el) + 'px';
    });
    persist();
  });

  // —— 初始化 ——
  async function init() {
    if (window.top !== window) return; // 仅顶层框架运行（双保险）
    try {
      pageKey = getPageKey();
    } catch (err) {
      return;
    }
    buildHost();
    await injectStyle();
    loadData();
  }

  init();
})();
