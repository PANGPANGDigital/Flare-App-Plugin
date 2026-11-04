# Weibo.Plugin — 微博最新时间线与超话签到

这是一个 Flare Social Plugin API v1 原型。插件提供自己的「最新微博」时间线。用户刷新该时间线时，插件先读取已关注超话列表中的签到按钮状态；只对按钮明确显示「签到」且带有签到地址的超话提交请求。随后加载微博最新内容。已签到和状态无法识别的超话会跳过。

## 当前行为

- 只在 `timeline.page` 收到 `refresh` 请求时签到；加载较旧微博的翻页不会触发签到。
- 每次刷新先查签到状态、再获取最新微博。签到失败会在时间线顶部显示摘要，但不会阻止微博内容加载。
- 这个插件有自己的微博账号和「最新微博」时间线；它不会接收 Flare 内置 VVO 微博账号的刷新事件。添加插件账号需要重新通过微博网页登录。
- 最新微博内容读取 `m.weibo.cn/feed/friends`，文字、作者、图片和转发内容映射到 Flare 时间线；点开微博会跳转到微博网页。
- 每次刷新都重新向微博读取状态。插件不保存“今天已运行”的本地标记，也不依赖不可靠的 JavaScript 全局变量。
- 每个签到请求顺序执行一次，不自动重试写请求。
- 刷新结果作为 Flare 时间线的应用消息显示：已签到、本次成功、失败和无法识别的数量；失败详情最多显示 10 项。
- 登录使用 Flare 的 WebCookie 流程。Cookie 只保存在当前插件账号凭据中，不应复制进源码或日志。
- 图片和头像使用 Flare 的 `mediaNetwork` 权限；插件只映射微博图片 CDN 地址。

## 本地开发

Node.js 22 或更新版本：

```sh
npm install
npm run build
```

在带有 Plugin development 功能的 Flare 构建中，打开 **Settings → Plugins → More → Plugin development**，选择本目录并启动。添加账号时选择 `https://m.weibo.cn` 作为 origin，再通过微博网页登录。刷新「最新微博」时间线可触发签到。

## 从 GitHub 安装

Flare 的 GitHub 安装器读取仓库根目录。回到仓库根目录维护的 `manifest.json`、`plugin.js` 和 `assets/icon.png` 是本项目的安装入口；源码仍保存在本目录。修改插件后，在本目录运行：

```sh
npm run publish:root
```

该命令会构建插件并同步运行文件到仓库根目录。提交根目录安装文件和本目录源码后，发布与 `manifest.json` 版本一致的稳定 tag，再在 Flare 插件管理中输入 `https://github.com/PANGPANGDigital/Flare-App-Plugin` 安装。当前项目版本为 `0.1.2`，tag 应为 `0.1.2` 或 `v0.1.2`。

项目使用 SDK 生成的 plugin ID 和 platform ID；更新时应保持它们不变。

## 接口与限制

微博没有在本项目中提供官方超话签到 API 文档。列表路径、按钮字段和签到 scheme 依据公开社区实现整理；这些接口可能变化。请求只允许发往账号所选的 `https://m.weibo.cn` origin。代码为 Host HTTP 请求附带微博 Referer 和 XSRF token，但尚未用真实 Flare Host 与微博账号验证；如果微博要求真实浏览器页面上下文或额外设备校验，Flare 插件运行时无法替代该页面上下文，需改用独立浏览器扩展或修改 Flare Host。

此插件不提供每日定时任务。签到只会在用户刷新此插件的「最新微博」时间线时检查。签到接口异常会显示为失败结果，不会对每个超话自动重试。

不要在公开 issue、源码、截图或日志里分享微博 Cookie、账号资料或真实私密内容。
