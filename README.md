# Flare-App-Plugin

Flare Social Plugin API v1 插件。

## 微博最新时间线与超话签到

插件提供自己的「最新微博」时间线。刷新时先检查已关注超话，只对明确未签到的项目提交签到，然后加载最新微博。它使用独立插件账号；不会监听 Flare 内置 VVO 微博账号的时间线刷新。详见 [Weibo.Plugin 文档](Weibo.Plugin/README.md)。

### 在 Flare 中安装

在 Flare 的插件管理中通过 GitHub 添加此仓库：

```text
https://github.com/PANGPANGDigital/Flare-App-Plugin
```

检查插件来源和媒体权限后确认安装。添加这个插件账号时选择 `https://m.weibo.cn` 作为 origin，并通过微博网页登录。打开它的「最新微博」时间线并刷新即可触发签到检查和加载最新内容。此账号与 Flare 内置微博账号分开登录。

### 仓库布局

`Weibo.Plugin/` 保留 TypeScript 源码和开发配置。Flare 安装器读取仓库根目录的 `manifest.json`、`plugin.js` 和 `assets/icon.png`；这些安装文件由子项目生成并同步到根目录。

在 `Weibo.Plugin/` 目录运行 `npm run publish:root`，会构建插件并更新根目录安装文件。发布时保持根目录和子项目的 manifest 版本一致，并创建匹配版本的稳定 tag（例如 `0.1.2` 或 `v0.1.2`）。
