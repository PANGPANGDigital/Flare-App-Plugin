"use strict";
(() => {
  // src/plugin.ts
  var API_CONFIG_PATH = "/api/config";
  var PROFILE_PATH = "/profile/info";
  var TOPICS_PATH = "/api/container/getIndex?containerid=100803_-_followsuper";
  var MAX_TOPIC_PAGES = 30;
  var MAX_FAILURE_DETAILS = 10;
  defineFlareSocialPlugin({
    login: {
      browser: {
        async begin(_request, context) {
          return { type: "webCookie", startUrl: context.origin + "/" };
        },
        async check(request, context) {
          const probeUrl = context.origin + API_CONFIG_PATH;
          const cookies = request.cookies.cookies.filter((cookie) => cookie.sourceUrl === probeUrl).filter((cookie) => ["SUB", "SUBP", "_T_WM"].includes(cookie.name)).map(({ name, value }) => ({ name, value }));
          if (!cookies.some((cookie) => cookie.name === "SUB" && cookie.value)) {
            return { type: "pending" };
          }
          const config = await requestJson(probeUrl, context, cookies, {}, true);
          if (!config || !isLoggedIn(config)) return { type: "pending" };
          const profileResponse = await requestJson(
            context.origin + PROFILE_PATH,
            context,
            cookies
          );
          if (!profileResponse) return { type: "pending" };
          const user = requiredObject(requiredObject(profileResponse.data).user);
          const profile = mapProfile(user, context);
          const credential = { cookies, profile };
          return {
            type: "success",
            value: {
              accountId: profile.key.id,
              origin: context.origin,
              credential,
              profile,
              capabilities: { "flare.datasource.timeline/v1": ["page"] }
            }
          };
        }
      }
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
          const results = [];
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
              name: "\u8D85\u8BDD\u5217\u8868",
              status: "failed",
              message: "\u8BFB\u53D6\u7B7E\u5230\u72B6\u6001\u5931\u8D25\uFF1B\u672A\u63D0\u4EA4\u7B7E\u5230\uFF0C\u8BF7\u7A0D\u540E\u5237\u65B0\u91CD\u8BD5\u3002"
            });
          }
          return {
            items: [await makeSummaryItem(results, truncated, credential.profile, context)],
            endReached: true
          };
        }
      }
    }
  });
  async function fetchFollowedTopics(context, cookies) {
    const config = await requestJson(context.origin + API_CONFIG_PATH, context, cookies);
    if (!config) fail("AuthenticationRequired", "\u5FAE\u535A\u767B\u5F55\u72B6\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    if (!isLoggedIn(config)) fail("AuthenticationRequired", "\u5FAE\u535A\u767B\u5F55\u72B6\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    const configData = requiredObject(config.data);
    const xsrfToken = typeof configData.st === "string" ? configData.st : "";
    const results = [];
    const toCheck = [];
    const seen = /* @__PURE__ */ new Set();
    let sinceId = "";
    let truncated = false;
    for (let page = 0; page < MAX_TOPIC_PAGES; page++) {
      const url = context.origin + TOPICS_PATH + (sinceId ? "&since_id=" + encodeURIComponent(sinceId) : "");
      const response = await requestJson(url, context, cookies);
      if (!response) fail("InvalidResponse", "\u5FAE\u535A\u6CA1\u6709\u8FD4\u56DE\u8D85\u8BDD\u5217\u8868\u3002");
      if (!isOkResponse(response.ok)) {
        fail("Remote", "\u5FAE\u535A\u6CA1\u6709\u8FD4\u56DE\u8D85\u8BDD\u5217\u8868\u3002");
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
          const button = Array.isArray(entry.buttons) && entry.buttons.length ? requiredObject(entry.buttons[0]) : {};
          const buttonName = typeof button.name === "string" ? button.name : "";
          const scheme = typeof button.scheme === "string" ? button.scheme : "";
          const id = topicId(scheme) || (typeof entry.itemid === "string" ? entry.itemid : name);
          if (seen.has(id)) continue;
          seen.add(id);
          added++;
          if (buttonName.includes("\u5DF2\u7B7E")) {
            results.push({ name, status: "already" });
          } else if (buttonName.includes("\u7B7E\u5230") && scheme) {
            toCheck.push({ name, id, signed: false, checkinUrl: resolveSameOriginUrl(scheme, context) });
          } else {
            results.push({ name, status: "unknown", message: "\u5FAE\u535A\u6CA1\u6709\u63D0\u4F9B\u53EF\u7528\u7684\u7B7E\u5230\u72B6\u6001\u3002" });
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
  async function checkInTopic(topic, xsrfToken, context, cookies) {
    if (!topic.checkinUrl) {
      return { name: topic.name, status: "failed", message: "\u7B7E\u5230\u5730\u5740\u4E0D\u662F\u5FAE\u535A\u5F53\u524D\u8D26\u53F7\u7AD9\u70B9\u3002" };
    }
    try {
      let url = topic.checkinUrl;
      if (xsrfToken && !/[?&]st=/.test(url)) {
        url += (url.includes("?") ? "&" : "?") + "st=" + encodeURIComponent(xsrfToken);
      }
      const response = await requestJson(url, context, cookies, {
        "x-xsrf-token": xsrfToken
      });
      if (!response) return { name: topic.name, status: "failed", message: "\u5FAE\u535A\u672A\u8FD4\u56DE\u7B7E\u5230\u7ED3\u679C\u3002" };
      const message = extractMessage(response);
      if (isOkResponse(response.ok)) {
        if (message.includes("\u5DF2\u7B7E")) return { name: topic.name, status: "already", message };
        return { name: topic.name, status: "success", message: message || "\u7B7E\u5230\u6210\u529F" };
      }
      if (message.includes("\u5DF2\u7B7E")) return { name: topic.name, status: "already", message };
      return { name: topic.name, status: "failed", message: safeRemoteMessage(message) };
    } catch (error) {
      if (isAuthenticationError(error)) throw error;
      return { name: topic.name, status: "failed", message: "\u7B7E\u5230\u8BF7\u6C42\u5931\u8D25\u6216\u5FAE\u535A\u62D2\u7EDD\u4E86\u8BF7\u6C42\u3002" };
    }
  }
  async function makeSummaryItem(results, truncated, profile, context) {
    const already = results.filter((item) => item.status === "already").length;
    const success = results.filter((item) => item.status === "success").length;
    const failed = results.filter((item) => item.status === "failed").length;
    const unknown = results.filter((item) => item.status === "unknown").length;
    const checked = already + success + failed + unknown;
    const lines = [
      `\u7B7E\u5230\u68C0\u67E5\u5B8C\u6210\uFF1A\u53D1\u73B0 ${checked} \u4E2A\u8D85\u8BDD\uFF0C\u5DF2\u7B7E\u5230 ${already} \u4E2A\uFF0C\u672C\u6B21\u6210\u529F ${success} \u4E2A\uFF0C\u5931\u8D25 ${failed} \u4E2A\u3002`
    ];
    if (unknown) lines.push(`${unknown} \u4E2A\u8D85\u8BDD\u7684\u7B7E\u5230\u72B6\u6001\u65E0\u6CD5\u8BC6\u522B\uFF0C\u5DF2\u8DF3\u8FC7\u3002`);
    if (truncated) lines.push(`\u8D85\u8BDD\u5217\u8868\u8FBE\u5230 ${MAX_TOPIC_PAGES} \u9875\u4E0A\u9650\uFF0C\u672A\u68C0\u67E5\u540E\u7EED\u9875\u9762\u3002`);
    const failures = results.filter((item) => item.status === "failed").slice(0, MAX_FAILURE_DETAILS);
    if (failures.length) {
      lines.push("\u5931\u8D25\u9879\uFF1A" + failures.map((item) => `${item.name}\uFF08${item.message || "\u8BF7\u6C42\u5931\u8D25"}\uFF09`).join("\uFF1B"));
    }
    return {
      type: "message",
      message: {
        key: { id: "checkin-" + await flare.crypto.uuid(), host: accountHost(context) },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        actor: profile,
        kind: "App",
        text: lines.join("\n")
      }
    };
  }
  async function requestJson(url, context, cookies, extraHeaders = {}, allowUnauthorized = false) {
    if (!isSameOrigin(url, context.origin)) {
      fail("Unsupported", "\u5FAE\u535A\u63A5\u53E3\u8DF3\u8F6C\u5230\u4E86\u6240\u9009\u8D26\u53F7\u7AD9\u70B9\u4E4B\u5916\uFF0C\u5DF2\u505C\u6B62\u8BF7\u6C42\u3002");
    }
    let response;
    try {
      response = await flare.http.request({
        method: "GET",
        url,
        cookies,
        headers: {
          referer: context.origin + "/",
          ...extraHeaders
        }
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "host.unavailable") {
        fail("Network", "Flare \u65E0\u6CD5\u8FDE\u63A5\u5FAE\u535A\u63A5\u53E3\u3002");
      }
      throw error;
    }
    if (response.status === 401 && allowUnauthorized) return null;
    if (response.status === 401 || response.status === 403) {
      fail("AuthenticationRequired", "\u5FAE\u535A\u767B\u5F55\u72B6\u6001\u5DF2\u5931\u6548\u6216\u8BF7\u6C42\u672A\u83B7\u6388\u6743\u3002");
    }
    if (response.status < 200 || response.status >= 300) {
      fail("Remote", "\u5FAE\u535A\u63A5\u53E3\u8FD4\u56DE HTTP " + response.status + "\u3002");
    }
    let value;
    try {
      value = JSON.parse(response.body);
    } catch {
      fail("InvalidResponse", "\u5FAE\u535A\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u6709\u6548 JSON\u3002");
    }
    return requiredObject(value);
  }
  async function readCredential() {
    const value = await flare.credential.read();
    if (!isRecord(value)) {
      fail("AuthenticationRequired", "\u5FAE\u535A\u767B\u5F55\u4FE1\u606F\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    }
    const record = value;
    if (!Array.isArray(record.cookies) || !isRecord(record.profile)) {
      fail("AuthenticationRequired", "\u5FAE\u535A\u767B\u5F55\u4FE1\u606F\u65E0\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    }
    const cookies = record.cookies.filter(isCookiePair);
    if (!cookies.some((cookie) => cookie.name === "SUB" && cookie.value)) {
      fail("AuthenticationRequired", "\u5FAE\u535A\u767B\u5F55 Cookie \u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55\u3002");
    }
    return { cookies, profile: record.profile };
  }
  function mapProfile(user, context) {
    const id = requiredScalarText(user.idstr ?? user.id);
    const handle = requiredScalarText(user.screen_name);
    return {
      key: { id, host: accountHost(context) },
      handle,
      displayName: handle
    };
  }
  function isLoggedIn(value) {
    const data = isRecord(value.data) ? value.data : {};
    return data.login === true || data.login === 1 || data.login === "1";
  }
  function isOkResponse(value) {
    return value === 1 || value === true || value === "1";
  }
  function topicId(scheme) {
    const match = /containerid=([\w-]+)/.exec(scheme);
    return match ? match[1] : "";
  }
  function resolveSameOriginUrl(scheme, context) {
    if (scheme.startsWith("/")) return context.origin + scheme;
    if (scheme.startsWith(context.origin + "/")) return scheme;
    return void 0;
  }
  function isSameOrigin(url, origin) {
    return url === origin || url.startsWith(origin + "/");
  }
  function extractMessage(value) {
    const data = isRecord(value.data) ? value.data : {};
    if (typeof data.msg === "string") return data.msg;
    const button = isRecord(data.button) ? data.button : {};
    if (typeof button.name === "string") return button.name;
    return typeof value.msg === "string" ? value.msg : "";
  }
  function safeRemoteMessage(value) {
    const message = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, 100);
    return message || "\u5FAE\u535A\u672A\u786E\u8BA4\u7B7E\u5230\u7ED3\u679C\u3002";
  }
  function isAuthenticationError(error) {
    return isRecord(error) && error.code === "AuthenticationRequired";
  }
  function isCookiePair(value) {
    return isRecord(value) && typeof value.name === "string" && typeof value.value === "string";
  }
  function accountHost(context) {
    return context.origin.slice("https://".length);
  }
  function requiredScalarText(value) {
    if (typeof value !== "string" && typeof value !== "number" || !String(value).trim()) {
      fail("InvalidResponse", "\u5FAE\u535A\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u8D26\u53F7\u8D44\u6599\u3002");
    }
    return String(value);
  }
  function requiredObject(value) {
    if (!isRecord(value)) fail("InvalidResponse", "\u5FAE\u535A\u63A5\u53E3\u8FD4\u56DE\u4E86\u975E\u5BF9\u8C61\u6570\u636E\u3002");
    return value;
  }
  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function fail(code, message) {
    throw flare.error({ code, message: { value: message } });
  }
})();
