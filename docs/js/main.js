// Momo Notes 官网脚本
// 职责：导航折叠、滚动入场动画、网页便利贴交互演示（纯前端，不调用 Chrome API）。

(function () {
  'use strict';

  // 标记 JS 可用，用于滚动入场动画（无 JS 时内容始终可见）
  document.documentElement.classList.add('js');

  /* —— 顶部导航 —— */
  const nav = document.getElementById('top');
  const toggle = document.querySelector('.nav-toggle');

  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  });

  // 点击菜单内锚点后收起移动端菜单
  nav.querySelectorAll('.nav-menu a[href^="#"]').forEach((a) => {
    a.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', '打开菜单');
    });
  });

  // 滚动时给导航加阴影
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* —— 滚动入场动画 —— */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* —— 页脚年份 —— */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* —— 便利贴交互演示 —— */
  const demoPage = document.getElementById('demo-page');
  const addBtn = document.getElementById('demo-add');
  const COLOR_NAMES = { pink: '粉色', yellow: '奶黄', mint: '薄荷绿', lavender: '薰衣草紫' };
  const COLOR_ORDER = ['pink', 'yellow', 'mint', 'lavender'];
  let noteCount = 0;

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // 把便利贴钳制到演示画布范围内
  function clampToPage(note) {
    const pr = demoPage.getBoundingClientRect();
    note.style.left = clamp(parseFloat(note.style.left) || 0, 0, Math.max(0, pr.width - note.offsetWidth)) + 'px';
    note.style.top = clamp(parseFloat(note.style.top) || 0, 0, Math.max(0, pr.height - note.offsetHeight)) + 'px';
  }

  function setColor(note, color) {
    COLOR_ORDER.forEach((c) => note.classList.remove('note--' + c));
    note.classList.add('note--' + color);
    note.dataset.color = color;
    note.querySelectorAll('.note__color').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.c === color);
    });
  }

  function onDelete(note) {
    if (!note.classList.contains('is-confirming')) {
      note.classList.add('is-confirming');
      note.querySelector('.note__delete').textContent = '确认';
      clearTimeout(note._confirmTimer);
      note._confirmTimer = setTimeout(() => exitConfirm(note), 2500);
      return;
    }
    note.remove();
  }

  function exitConfirm(note) {
    note.classList.remove('is-confirming');
    const del = note.querySelector('.note__delete');
    if (del) del.textContent = '✕';
    clearTimeout(note._confirmTimer);
  }

  function makeDraggable(note) {
    const header = note.querySelector('.note__header');
    let drag = null;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.note__color, .note__delete, .note__cancel')) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const pr = demoPage.getBoundingClientRect();
      const nr = note.getBoundingClientRect();
      drag = { startX: e.clientX, startY: e.clientY, origX: nr.left - pr.left, origY: nr.top - pr.top };
      note.classList.add('is-dragging');
      try { header.setPointerCapture(e.pointerId); } catch (err) {}
    });

    header.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const pr = demoPage.getBoundingClientRect();
      const nx = clamp(drag.origX + (e.clientX - drag.startX), 0, pr.width - note.offsetWidth);
      const ny = clamp(drag.origY + (e.clientY - drag.startY), 0, pr.height - note.offsetHeight);
      note.style.left = nx + 'px';
      note.style.top = ny + 'px';
    });

    const end = (e) => {
      if (!drag) return;
      drag = null;
      note.classList.remove('is-dragging');
      try { header.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);

    // 键盘替代：焦点在标题栏时用方向键移动
    header.addEventListener('keydown', (e) => {
      if (e.target !== header) return;
      const dir = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };
      if (!(e.key in dir)) return;
      e.preventDefault();
      const step = e.shiftKey ? 4 : 16;
      const pr = demoPage.getBoundingClientRect();
      let x = parseFloat(note.style.left) || 0;
      let y = parseFloat(note.style.top) || 0;
      if (e.key === 'ArrowLeft') x -= step;
      else if (e.key === 'ArrowRight') x += step;
      else if (e.key === 'ArrowUp') y -= step;
      else if (e.key === 'ArrowDown') y += step;
      note.style.left = clamp(x, 0, pr.width - note.offsetWidth) + 'px';
      note.style.top = clamp(y, 0, pr.height - note.offsetHeight) + 'px';
    });
  }

  function createNote(color) {
    const note = document.createElement('div');
    note.className = 'note demo-note note--' + color;
    note.dataset.color = color;

    const header = document.createElement('div');
    header.className = 'note__header';
    header.setAttribute('tabindex', '0');
    header.setAttribute('role', 'group');
    header.setAttribute('aria-label', '便利贴，按住标题栏拖动，或用方向键移动');

    const grip = document.createElement('span');
    grip.className = 'note__grip';

    const colors = document.createElement('div');
    colors.className = 'note__colors';
    COLOR_ORDER.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'note__color' + (c === color ? ' is-active' : '');
      b.dataset.c = c;
      b.setAttribute('aria-label', COLOR_NAMES[c]);
      b.addEventListener('click', (e) => { e.stopPropagation(); setColor(note, c); });
      colors.appendChild(b);
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'note__cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', (e) => { e.stopPropagation(); exitConfirm(note); });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'note__delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', '删除便利贴');
    del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(note); });

    header.appendChild(grip);
    header.appendChild(colors);
    header.appendChild(cancel);
    header.appendChild(del);

    const body = document.createElement('textarea');
    body.className = 'note__body';
    body.placeholder = '写点什么…';
    body.setAttribute('aria-label', '便利贴内容');

    note.appendChild(header);
    note.appendChild(body);

    const offset = 28 + (noteCount % 5) * 26;
    noteCount += 1;
    note.style.left = offset + 'px';
    note.style.top = offset + 'px';

    demoPage.appendChild(note);
    makeDraggable(note);
    return note;
  }

  addBtn.addEventListener('click', () => {
    const color = COLOR_ORDER[noteCount % COLOR_ORDER.length];
    const note = createNote(color);
    note.querySelector('.note__body').focus();
  });

  // 初始示例便利贴（位置按画布尺寸钳制，避免窄屏溢出）
  const seed1 = createNote('pink');
  seed1.querySelector('.note__body').value = '想到的灵感，随手记下来';
  seed1.style.left = '140px';
  seed1.style.top = '96px';
  clampToPage(seed1);
  const seed2 = createNote('mint');
  seed2.querySelector('.note__body').value = '这条可以拖动、换色';
  seed2.style.left = '360px';
  seed2.style.top = '180px';
  clampToPage(seed2);
})();
