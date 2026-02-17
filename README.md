# ☁️ 云端记账本 · Cloud Ledger

<p align="center">
  <img src="icons/apple-touch-icon.png" alt="云端记账本" width="120" />
</p>

<p align="center">
  <strong>极简 · 实时同步 · 数据安全</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue.svg?style=flat-square" alt="Version 2.0.0" />
  <img src="https://img.shields.io/badge/PWA-✓-brightgreen.svg?style=flat-square" alt="PWA Supported" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/PRs-welcome-orange.svg?style=flat-square" alt="PRs Welcome" />
</p>

---

<br>

## 📖 项目介绍

**云端记账本** 是一款基于 GitHub API 的极简个人记账 PWA 应用。  
无需后端服务器，你的数据直接安全地存储在你的 GitHub 仓库中，多设备实时同步，隐私无忧。

> 🎯 目标：用最简单的方式，帮你养成记账习惯。

<br>

## ✨ 功能特点

- 📱 **PWA 支持** – 可安装到手机桌面，离线可用，媲美原生 App。
- 🔐 **GitHub 存储** – 数据完全归你所有，不经过任何第三方服务器。
- ⚡ **实时同步** – 一处修改，多端自动同步，始终最新。
- 📊 **智能分析** – 支出分类图表、月度趋势、年度报表一目了然。
- 💰 **预算管理** – 设置月度预算，超支自动预警。
- 🏷️ **灵活分类** – 自定义收入/支出/借贷分类，满足各种场景。
- 📂 **数据导出** – 支持 CSV / JSON 格式导出，打印报表。
- 🌗 **深色模式** – 自动跟随系统或手动切换，护眼舒适。
- 📶 **离线可用** – 断网时本地存储，联网后自动同步，不丢一笔记录。

<br>

## 🛠️ 技术架构

- **前端**：原生 HTML5 / CSS3 / JavaScript (ES6+)
- **图表**：Chart.js
- **图标**：Font Awesome 6
- **数据存储**：GitHub REST API v3 (用户个人仓库)
- **PWA**：Service Worker + Manifest，可安装离线应用
- **认证**：GitHub Personal Access Token（仅需 `repo` 权限）

<br>

## 🚀 快速开始

### 1️⃣ 注册 / 登录

1. 打开 `index.html`，点击「注册」标签。
2. 输入你的 GitHub **Personal Access Token**（需要 `repo` 权限）。
3. 输入已存在的仓库名（格式：`用户名/仓库名`），确保你有写入权限。
4. 设置你的用户名和密码（密码经过 Base64 编码存储，非明文）。
5. 点击注册，系统会自动在你的仓库中创建 `/data/用户名.json` 数据文件。
6. 注册成功后自动跳转到记账主页。

> 🔑 **如何生成 GitHub Token？**  
> 访问 GitHub Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾选 `repo` 权限，生成后复制保存。

### 2️⃣ 安装 PWA（可选）

- **Android / Chrome**：访问页面后，地址栏会出现「安装应用」图标，点击即可添加到桌面。
- **iOS / Safari**：点击「分享」按钮，选择「添加到主屏幕」。

安装后，即可像原生应用一样从桌面启动，支持离线访问。

<br>

## 📘 使用指南

### 📝 记账

- 点击底部导航「记账」或侧边栏「记账」。
- 选择类型（收入/支出/借贷）、分类、描述、金额、日期。
- 点击「添加记录」，数据自动同步到云端。

### 📋 记录管理

- 「所有记录」页面可按类型、分类、关键词筛选，支持分页。
- 点击记录右侧的 ✏️ 可编辑，🗑️ 可删除。

### 📈 数据分析

- 仪表盘显示当前筛选时间范围内的总收入/支出/借贷/余额。
- 支出分类饼图、月度收支柱状图自动更新。
- 「数据分析」页面提供收支比例饼图、趋势折线图、年度报表。

### 💵 预算设置

- 进入「预算管理」，为总支出或特定分类设置月度预算。
- 进度条实时显示已用比例，超过 80% 自动在侧边栏预警。

### 🏷️ 分类管理

- 可自由添加/编辑/删除收入、支出、借贷分类。
- 删除分类时，已有记录会自动归入该类型的第一个分类。

### ⚙️ 设置

- 修改 GitHub 仓库或 Token。
- 调整同步策略、主题、预警阈值。
- 危险操作区：清除本地缓存、删除账户（将删除云端数据，谨慎操作）。

<br>

## 🤝 贡献指南

欢迎任何形式的贡献！你可以：

- 🐛 提交 [Issue] 报告 Bug 或建议新功能
- 🔧 发起 Pull Request 修复问题或优化代码
- 🌍 帮助完善文档或翻译

**开发流程：**

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 发起 Pull Request

<br>

## 📄 许可证

本项目基于 **MIT 许可证** 开源 – 你可以自由使用、修改、分发，但需保留版权声明。

<br>

<p align="center">
  Made with ❤️ by 云端记账本 Team · 你的数据，完全由你掌控。
</p>
