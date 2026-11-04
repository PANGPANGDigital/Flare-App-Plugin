type CookiePair = { name: string; value: string };
type StoredCredential = { cookies: CookiePair[]; profile: ProfileV1 };
type Topic = {
  id: string;
  name: string;
  signed: boolean;
  checkinUrl?: string;
};
type TopicResult = {
  name: string;
  status: "already" | "success" | "failed" | "unknown";
  message?: string;
};

const API_CONFIG_PATH = "/api/config";
const PROFILE_PATH = "/profile/info";
const TOPICS_PATH = "/api/container/getIndex?containerid=100803_-_followsuper";
const MAX_TOPIC_PAGES = 30;
const MAX_FAILURE_DETAILS = 10;

defineFlareSocialPlugin({
  login: {
    browser: {
      async begin(_request, context) {
        return { type: "webCookie", startUrl: context.origin + "/" };
      },
      async check(request, context) {
        const probeUrl = context.origin + API_CONFIG_PATH;
        const cookies = request.cookies.cookies
          .filter((cookie) => cookie.sourceUrl === probeUrl)
          .filter((cookie) => ["SUB", "SUBP", "_T_WM"].includes(cookie.name))
          .map(({ name, value }) => ({ name, value }));
        if (!cookies.some((cookie) => cookie.name === "SUB" && cookie.value)) {
          return { type: "pending" };
        }

        const config = await requestJson(probeUrl, context, cookies, {}, true);
        if (!config || !isLoggedIn(config)) return { type: "pending" };

        const profileResponse = await requestJson(
          context.origin + PROFILE_PATH,
          context,
          cookies,
        );
        if (!profileResponse) return { type: "pending" };
        const user = requiredObject(requiredObject(profileResponse.data).user);
        const profile = mapProfile(user, context);
        const credential: StoredCredential = { cookies, profile };

        return {
          type: "success",
          value: {
            accountId: profile.key.id,
            origin: context.origin,
            credential: credential as unknown as JsonValue,
            profile,
            capabilities: { "flare.datasource.timeline/v1": ["page"] },
          },
        };
      },
    },
  },
  capabilities: {
    timeline: {
      async page(request, context) {
        if (request.timelineId !== "checkin") {
          fail("Unsupported", "Unknown timeline");
        }
        if (request.page.direction !== "refresh") {
          return { items: [], endReached: true };
        }

        const credential = await readCredential();
        const results: TopicResult[] = [];
        let truncated = false;

        try {
          const topicPage = await fetchFollowedTopics(context, credential.cookies);
          results.push(...topicPage.results);
          truncated = topicPage.truncated;

          for (const topic of topicPage.toCheck) {
            results.push(await checkInTopic(topic, topicPage.xsrfToken, context, credential.cookies));
          }
        } catch (error) {
          if (isAuthenticationError(error)) throw error;
          results.push({
            name: "超话列表",
            status: "failed",
            message: "读取签到状态失败；未提交签到，请稍后刷新重试。",
          });
        }

        return {
          items: [await makeSummaryItem(results, truncated, credential.profile, context)],
          endReached: true,
        };
      },
    },
  },
});

async function fetchFollowedTopics(
  context: PluginInvocationContextV1,
  cookies: CookiePair[],
): Promise<{ results: TopicResult[]; toCheck: Topic[]; xsrfToken: string; truncated: boolean }> {
  const config = await requestJson(context.origin + API_CONFIG_PATH, context, cookies);
  if (!config) fail("AuthenticationRequired", "微博登录状态已失效，请重新登录。");
  if (!isLoggedIn(config)) fail("AuthenticationRequired", "微博登录状态已失效，请重新登录。");
  const configData = requiredObject(config.data);
  const xsrfToken = typeof configData.st === "string" ? configData.st : "";

  const results: TopicResult[] = [];
  const toCheck: Topic[] = [];
  const seen = new Set<string>();
  let sinceId = "";
  let truncated = false;

  for (let page = 0; page < MAX_TOPIC_PAGES; page++) {
    const url = context.origin + TOPICS_PATH +
      (sinceId ? "&since_id=" + encodeURIComponent(sinceId) : "");
    const response = await requestJson(url, context, cookies);
    if (!response) fail("InvalidResponse", "微博没有返回超话列表。");
    if (!isOkResponse(response.ok)) {
      fail("Remote", "微博没有返回超话列表。");
    }

    const data = requiredObject(response.data);
    const cards = Array.isArray(data.cards) ? data.cards : [];
    let added = 0;
    for (const cardValue of cards) {
      const card = requiredObject(cardValue);
      const entries = Array.isArray(card.card_group) ? card.card_group : [cardValue];
      for (const entryValue of entries) {
        const entry = requiredObject(entryValue);
        const name = typeof entry.title_sub === "string" ? entry.title_sub.trim() : "";
        if (!name) continue;

        const button = Array.isArray(entry.buttons) && entry.buttons.length
          ? requiredObject(entry.buttons[0])
          : {};
        const buttonName = typeof button.name === "string" ? button.name : "";
        const scheme = typeof button.scheme === "string" ? button.scheme : "";
        const id = topicId(scheme) || (typeof entry.itemid === "string" ? entry.itemid : name);
        if (seen.has(id)) continue;
        seen.add(id);
        added++;

        if (buttonName.includes("已签")) {
          results.push({ name, status: "already" });
        } else if (buttonName.includes("签到") && scheme) {
          toCheck.push({ name, id, signed: false, checkinUrl: resolveSameOriginUrl(scheme, context) });
        } else {
          results.push({ name, status: "unknown", message: "微博没有提供可用的签到状态。" });
        }
      }
    }

    const info = isRecord(data.cardlistInfo) ? data.cardlistInfo : {};
    const next = typeof info.since_id === "string" ? info.since_id : "";
    if (!next || next === sinceId || added === 0) break;
    sinceId = next;
    if (page === MAX_TOPIC_PAGES - 1) truncated = true;
  }

  return { results, toCheck, xsrfToken, truncated };
}

async function checkInTopic(
  topic: Topic,
  xsrfToken: string,
  context: PluginInvocationContextV1,
  cookies: CookiePair[],
): Promise<TopicResult> {
  if (!topic.checkinUrl) {
    return { name: topic.name, status: "failed", message: "签到地址不是微博当前账号站点。" };
  }

  try {
    let url = topic.checkinUrl;
    if (xsrfToken && !/[?&]st=/.test(url)) {
      url += (url.includes("?") ? "&" : "?") + "st=" + encodeURIComponent(xsrfToken);
    }
    const response = await requestJson(url, context, cookies, {
      "x-xsrf-token": xsrfToken,
    });
    if (!response) return { name: topic.name, status: "failed", message: "微博未返回签到结果。" };
    const message = extractMessage(response);
    if (isOkResponse(response.ok)) {
      if (message.includes("已签")) return { name: topic.name, status: "already", message };
      return { name: topic.name, status: "success", message: message || "签到成功" };
    }
    if (message.includes("已签")) return { name: topic.name, status: "already", message };
    return { name: topic.name, status: "failed", message: safeRemoteMessage(message) };
  } catch (error) {
    if (isAuthenticationError(error)) throw error;
    return { name: topic.name, status: "failed", message: "签到请求失败或微博拒绝了请求。" };
  }
}

async function makeSummaryItem(
  results: TopicResult[],
  truncated: boolean,
  profile: ProfileV1,
  context: PluginInvocationContextV1,
): Promise<TimelineItemV1> {
  const already = results.filter((item) => item.status === "already").length;
  const success = results.filter((item) => item.status === "success").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const unknown = results.filter((item) => item.status === "unknown").length;
  const checked = already + success + failed + unknown;
  const lines = [
    `签到检查完成：发现 ${checked} 个超话，已签到 ${already} 个，本次成功 ${success} 个，失败 ${failed} 个。`,
  ];
  if (unknown) lines.push(`${unknown} 个超话的签到状态无法识别，已跳过。`);
  if (truncated) lines.push(`超话列表达到 ${MAX_TOPIC_PAGES} 页上限，未检查后续页面。`);
  const failures = results.filter((item) => item.status === "failed").slice(0, MAX_FAILURE_DETAILS);
  if (failures.length) {
    lines.push("失败项：" + failures.map((item) => `${item.name}（${item.message || "请求失败"}）`).join("；"));
  }

  return {
    type: "message",
    message: {
      key: { id: "checkin-" + await flare.crypto.uuid(), host: accountHost(context) },
      createdAt: new Date().toISOString(),
      actor: profile,
      kind: "App",
      text: lines.join("\n"),
    },
  };
}

async function requestJson(
  url: string,
  context: PluginInvocationContextV1,
  cookies: CookiePair[],
  extraHeaders: Record<string, string> = {},
  allowUnauthorized = false,
): Promise<Record<string, unknown> | null> {
  if (!isSameOrigin(url, context.origin)) {
    fail("Unsupported", "微博接口跳转到了所选账号站点之外，已停止请求。");
  }

  let response: HttpResponseV1;
  try {
    response = await flare.http.request({
      method: "GET",
      url,
      cookies,
      headers: {
        referer: context.origin + "/",
        ...extraHeaders,
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "host.unavailable") {
      fail("Network", "Flare 无法连接微博接口。");
    }
    throw error;
  }

  if (response.status === 401 && allowUnauthorized) return null;
  if (response.status === 401 || response.status === 403) {
    fail("AuthenticationRequired", "微博登录状态已失效或请求未获授权。");
  }
  if (response.status < 200 || response.status >= 300) {
    fail("Remote", "微博接口返回 HTTP " + response.status + "。");
  }

  let value: unknown;
  try {
    value = JSON.parse(response.body);
  } catch {
    fail("InvalidResponse", "微博接口没有返回有效 JSON。");
  }
  return requiredObject(value);
}

async function readCredential(): Promise<StoredCredential> {
  const value = await flare.credential.read();
  if (!isRecord(value)) {
    fail("AuthenticationRequired", "微博登录信息无效，请重新登录。");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.cookies) || !isRecord(record.profile)) {
    fail("AuthenticationRequired", "微博登录信息无效，请重新登录。");
  }
  const cookies = record.cookies.filter(isCookiePair);
  if (!cookies.some((cookie) => cookie.name === "SUB" && cookie.value)) {
    fail("AuthenticationRequired", "微博登录 Cookie 已失效，请重新登录。");
  }
  return { cookies, profile: record.profile as unknown as ProfileV1 };
}

function mapProfile(user: Record<string, unknown>, context: PluginInvocationContextV1): ProfileV1 {
  const id = requiredScalarText(user.idstr ?? user.id);
  const handle = requiredScalarText(user.screen_name);
  return {
    key: { id, host: accountHost(context) },
    handle,
    displayName: handle,
  };
}

function isLoggedIn(value: Record<string, unknown>): boolean {
  const data = isRecord(value.data) ? value.data : {};
  return data.login === true || data.login === 1 || data.login === "1";
}

function isOkResponse(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function topicId(scheme: string): string {
  const match = /containerid=([\w-]+)/.exec(scheme);
  return match ? match[1] : "";
}

function resolveSameOriginUrl(scheme: string, context: PluginInvocationContextV1): string | undefined {
  if (scheme.startsWith("/")) return context.origin + scheme;
  if (scheme.startsWith(context.origin + "/")) return scheme;
  return undefined;
}

function isSameOrigin(url: string, origin: string): boolean {
  return url === origin || url.startsWith(origin + "/");
}

function extractMessage(value: Record<string, unknown>): string {
  const data = isRecord(value.data) ? value.data : {};
  if (typeof data.msg === "string") return data.msg;
  const button = isRecord(data.button) ? data.button : {};
  if (typeof button.name === "string") return button.name;
  return typeof value.msg === "string" ? value.msg : "";
}

function safeRemoteMessage(value: string): string {
  const message = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, 100);
  return message || "微博未确认签到结果。";
}

function isAuthenticationError(error: unknown): boolean {
  return isRecord(error) && error.code === "AuthenticationRequired";
}

function isCookiePair(value: unknown): value is CookiePair {
  return isRecord(value) && typeof value.name === "string" && typeof value.value === "string";
}

function accountHost(context: PluginInvocationContextV1): string {
  return context.origin.slice("https://".length);
}

function requiredScalarText(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) {
    fail("InvalidResponse", "微博没有返回有效账号资料。");
  }
  return String(value);
}

function requiredObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail("InvalidResponse", "微博接口返回了非对象数据。");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(code: PluginErrorCodeV1, message: string): never {
  throw flare.error({ code, message: { value: message } });
}
