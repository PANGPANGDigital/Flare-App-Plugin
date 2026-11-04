# Weibo.Plugin — 微博超话签到

这是一个 Flare Social Plugin API v1 原型。用户刷新「超话签到记录」时间线时，插件读取已关注超话列表中的签到按钮状态；只对按钮明确显示「签到」且带有签到地址的超话提交请求。已签到和状态无法识别的条目会跳过。

## 当前行为

- 只在 `timeline.page` 收到 `refresh` 请求时执行；翻页不会触发签到。
- 每次刷新都重新向微博读取状态。插件不保存“今天已运行”的本地标记，也不依赖不可靠的 JavaScript 全局变量。
- 每个签到请求顺序执行一次，不自动重试写请求。
- 刷新结果作为 Flare 时间线的应用消息显示：已签到、本次成功、失败和无法识别的数量；失败详情最多显示 10 项。
- 登录使用 Flare 的 WebCookie 流程。Cookie 只保存在当前 Flare 账号凭据中，不应复制进源码或日志。

## 本地开发

Node.js 22 或更新版本：

```sh
npm install
npm run build
```

在带有 Plugin development 功能的 Flare 构建中，打开 **Settings → Plugins → More → Plugin development**，选择本目录并启动。添加账号时选择 `https://m.weibo.cn` 作为 origin，再通过微博网页登录。刷新「超话签到记录」时间线可触发流程。

项目使用 SDK 生成的 plugin ID 和 platform ID；更新时应保持它们不变。

## 接口与限制

微博没有在本项目中提供官方超话签到 API 文档。列表路径、按钮字段和签到 scheme 依据公开社区实现整理；这些接口可能变化。请求只允许发往账号所选的 `https://m.weibo.cn` origin。代码为 Host HTTP 请求附带微博 Referer 和 XSRF token，但尚未用真实 Flare Host 与微博账号验证；如果微博要求真实浏览器页面上下文或额外设备校验，Flare 插件运行时无法替代该页面上下文，需改用独立浏览器扩展或修改 Flare Host。

此插件不提供每日定时任务。签到只会在用户打开/刷新此插件的签到时间线时检查。签到接口异常会显示为失败结果，不会对每个超话自动重试。

不要在公开 issue、源码、截图或日志里分享微博 Cookie、账号资料或真实私密内容。
