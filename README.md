# Flare-App-Plugin

Flare Social Plugin API v1 插件。

## 微博超话签到

刷新「超话签到记录」时间线时，检查已关注超话的签到状态，只对明确未签到的项目提交签到。详见 [Weibo.Plugin 文档](Weibo.Plugin/README.md)。

### 在 Flare 中安装

在 Flare 的插件管理中通过 GitHub 添加此仓库：

```text
https://github.com/PANGPANGDigital/Flare-App-Plugin
```

检查插件来源和权限后确认安装。添加账号时选择 `https://m.weibo.cn` 作为 origin，并通过微博网页登录。打开「超话签到记录」时间线并刷新即可触发状态检查和签到。

### 仓库布局

`Weibo.Plugin/` 保留 TypeScript 源码和开发配置。Flare 安装器读取仓库根目录的 `manifest.json`、`plugin.js` 和 `assets/icon.png`；这些安装文件由子项目生成并同步到根目录。

在 `Weibo.Plugin/` 目录运行 `npm run publish:root`，会构建插件并更新根目录安装文件。发布时保持根目录和子项目的 manifest 版本一致，并创建匹配版本的稳定 tag（例如 `0.1.1` 或 `v0.1.1`）。
