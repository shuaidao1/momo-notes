// Momo Notes 弹窗逻辑
// 职责：读取当前标签页、与内容脚本通信、展示计数与入口、处理不支持页面。

'use strict';

const countEl = document.getElementById('count');
const btnNew = document.getElementById('btn-new');
const btnToggle = document.getElementById('btn-toggle');
const toggleLabel = document.getElementById('toggle-label');

let tabId = null;

// 获取当前活动标签页 id（tab.id 无需额外权限即可获取）
async function getActiveTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length ? tabs[0].id : null;
  } catch (err) {
    return null;
  }
}

// 向当前页内容脚本发消息；失败（无接收端）会抛出异常
async function send(msg) {
  if (tabId == null) tabId = await getActiveTabId();
  if (tabId == null) throw new Error('no-active-tab');
  return chrome.tabs.sendMessage(tabId, msg);
}

function setUnsupported(on) {
  document.body.classList.toggle('unsupported', on);
}

function setVisible(v) {
  toggleLabel.textContent = v ? '隐藏便利贴' : '显示便利贴';
  btnToggle.setAttribute('aria-pressed', String(v));
}

async function refresh() {
  try {
    const res = await send({ type: 'GET_STATE' });
    if (res && res.ok) {
      setUnsupported(false);
      countEl.textContent = String(res.count);
      setVisible(res.visible);
    } else {
      setUnsupported(true);
    }
  } catch (err) {
    // chrome:// 等页面无内容脚本接收端
    setUnsupported(true);
  }
}

btnNew.addEventListener('click', async () => {
  try {
    const res = await send({ type: 'CREATE_NOTE' });
    if (res && res.ok) {
      setUnsupported(false);
      countEl.textContent = String(res.count);
    } else {
      setUnsupported(true);
    }
  } catch (err) {
    setUnsupported(true);
  }
});

btnToggle.addEventListener('click', async () => {
  try {
    const res = await send({ type: 'TOGGLE_NOTES' });
    if (res && res.ok) {
      setUnsupported(false);
      setVisible(res.visible);
    } else {
      setUnsupported(true);
    }
  } catch (err) {
    setUnsupported(true);
  }
});

refresh();
