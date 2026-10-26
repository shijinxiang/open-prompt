# 开放题记录库

Windows 本地题库软件，支持题目、考点、模型回复、截图和五模型排序管理，并可与配套 Chrome 填写助手共享题库。

## 安装与升级

从仓库 Releases 下载 `OpenQuestionStudio-Setup-版本号.exe`，首次安装后使用桌面或开始菜单中的“开放题记录库”。后续在“设置 → 软件安装与更新”中检查、下载、安装新版本。

安装向导可选择安装文件夹，首次安装默认位于 C 盘的当前用户程序目录（通常为 `C:\Users\用户名\AppData\Local\Programs\open-question-labeling-studio`）。可浏览其他磁盘或输入自定义路径。已有安装默认沿用上次选择的位置，软件内更新也会在该位置覆盖升级。

安装包旁若存在原项目或旧免安装版题库，安装器会尝试沿用它。也可在安装版设置中点击“关联已有题库并重启”，选择原来的 `data` 文件夹。题库放在安装目录之外，覆盖升级和卸载程序会保留题库。正在使用的题库位置可在软件内查看。

免安装版仍可使用。安装版才能进行软件内升级；升级安装前会保存当前内容，并校验下载文件的大小及 SHA-512。

## 功能

- 题目正文、决定性和非决定性考点、三至五模型回复与排序。
- 截图添加、粘贴、拖出、复制及滚轮缩放查看。
- 未归档与已归档记录、搜索、资料完成度提醒。
- 完整 JSON 备份、大备份分段读写、多文件合并导入及目录记忆。
- 仅题目 TXT 导出，可按归档状态或自选记录导出。
- 可收起侧栏、可调整列表宽度和窄窗口布局。
- 配套 Chrome 助手支持本机共享题库、独立 JSON 导入、题号绑定及分区覆盖。

题库、截图、备份、本机认证配置均不随源码仓库发布。共享题库接口只绑定本机回环地址。

## 开发

使用 Node.js 24：

```sh
npm ci
npm run dev
npm test
npm run dist
```

构建产物在 `release/`：安装器、免安装程序。桌面与 Chrome 集成测试位于 `tests/`，使用独立测试目录；需要本机 Windows、Electron 与 Chrome。

## 发布更新

更新 `package.json` 和锁文件中的版本，维护 `distribution/release-notes.txt`，推送对应的 `v版本号` 标签。GitHub Actions 会构建安装器并发布安装包和 `update.json`。软件可使用“用户名/仓库名”作为更新来源，或使用放有 `update.json` 的 HTTPS 目录。

手动构建并生成更新清单：

```sh
node scripts/configure-release.cjs 用户名/仓库名
npm run dist
node scripts/create-update-manifest.cjs 用户名/仓库名
```

将安装器与 `release/update.json` 放到同一版本的 Release。仓库尚无 Release 时，软件会提示更新源未准备好，日常题库功能仍可使用。

当前未配置代码签名证书，Windows 可能显示发布者未验证。请从自己的仓库发布页取得程序。
