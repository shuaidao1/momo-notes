# Momo Notes｜桃桃便利贴

一个可爱的粉色系 Chrome 浏览器扩展：在任意普通网页上创建、编辑、拖动并保存便利贴，方便在浏览、查阅资料、学习时随手记录灵感。数据仅保存在本地浏览器。

## 功能

- 点击工具栏图标打开 Popup，可「新建便利贴」「显示/隐藏便利贴」，并查看当前页便利贴数量。
- 便利贴支持输入与修改文字，支持四种颜色（粉色 / 奶黄 / 薄荷绿 / 薰衣草紫），默认柔和粉色。
- 按住便利贴顶部标题栏即可拖动，松开自动保存位置，并限制不会完全移出屏幕。
- 删除便利贴需二次确认（防误触）。
- 数据按网页 URL 隔离存储于 `chrome.storage.local`，刷新页面自动恢复，重开 Chrome 后仍在，不同网页互不影响。

## 安装

1. 打开 `chrome://extensions`。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目目录。
4. 点击工具栏的 Momo Notes 图标即可使用。

## 目录结构

```
momo-notes/
├── manifest.json        # MV3 清单：权限、action、content_scripts、图标
├── popup.html           # 弹窗结构
├── popup.css            # 弹窗样式
├── popup.js             # 弹窗逻辑
├── content.js           # 内容脚本：注入、渲染、拖动、编辑、删除、存储
├── content.css          # 便利贴样式（注入到 Shadow DOM 内）
├── assets/
│   ├── icons/           # 扩展图标（16/32/48/128）
│   └── mascot.svg       # 原创「桃桃」吉祥物
└── README.md
```

## 技术要点

- **Manifest V3**，原生 HTML/CSS/JavaScript，无框架、无构建、无需服务器与 API Key。
- **权限最小化**：仅申请 `storage` 权限与 `http/https` 主机权限（用于在普通网页注入内容脚本）。
- **样式隔离**：便利贴全部渲染在 `mode:'closed'` 的 Shadow DOM 内，与宿主网页 CSS 互不影响。
- **按页隔离存储**：每个页面使用独立存储键 `momoNote:<origin+pathname>`，避免多标签页写入竞争；去除 URL 的 query/hash，翻页或锚点变化不会导致便利贴“消失”。
- **安全**：用户输入一律通过 `textarea.value` 处理，不使用 `innerHTML`；不读取 Cookie、密码等敏感信息，不联网上传。

## 已知限制

- `chrome://`、浏览器商店、`view-source:` 等特殊页面无法注入，Popup 会显示「此页面不支持便利贴」。
- 单页应用（SPA）在无刷新的路由切换下，便利贴按首次加载的 URL 归类（第一版不追踪 SPA 路由）。
- 同一 URL 在多个标签页/窗口会共享同一份便利贴（预期行为）。
