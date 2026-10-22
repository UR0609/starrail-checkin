import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cron from "node-cron";
import { createRunner } from "./checkin.js";
import {
  aigisHeader,
  createQr,
  exchangeGameToken,
  exchangeWebTokens,
  loginByPhoneCode,
  newDevice,
  parseAigis,
  queryQr,
  registerDeviceFp,
  sendLoginCode,
} from "./mihoyo.js";
import { changeGatePassword, createGateFile, loadGate } from "./gate.js";
import { createStore, toPublic } from "./store.js";
import { mergeSignedDates } from "./sign.js";
import { clampTime, isPastSlot, nextRunAt, shanghaiDate, shouldCatchUp } from "./time.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.resolve(here, "../../data");
const distDir = path.resolve(here, "../../client/dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const store = createStore(dataDir);
const runner = createRunner(store);
const sessions = new Map();
const smsSessions = new Map();
const smsSentAt = new Map();
let cronTask = null;

function signedDatesFor(role, history) {
  const seen = [...(role.signedDates || [])];
  for (const item of history) {
    if (String(item.gameUid) !== String(role.gameUid) || !item.ok) continue;
    if (!/签过|签到成功/.test(item.message || "")) continue;
    seen.push(shanghaiDate(new Date(item.at)));
  }
  return mergeSignedDates(seen, null);
}

function publicState(data) {
  return {
    accounts: data.accounts.map((account) => {
      const pub = toPublic(account);
      pub.roles = pub.roles.map((role) => ({
        ...role,
        signedDates: signedDatesFor(role, data.history),
      }));
      return pub;
    }),
    settings: { hour: data.settings.hour, minute: data.settings.minute },
    nextRunAt: nextRunAt(data.settings.hour, data.settings.minute),
    history: data.history.slice(0, 80),
  };
}

async function schedule() {
  const data = await store.read();
  if (cronTask) cronTask.stop();
  const { hour, minute } = data.settings;
  cronTask = cron.schedule(
    `${minute} ${hour} * * *`,
    () => {
      runner.run({ sign: true, reason: "auto" }).catch((error) => {
        console.error("[签到] 定时任务失败", error.message);
      });
    },
    { timezone: "Asia/Shanghai" },
  );
  if (shouldCatchUp({ ...data.settings })) {
    runner.run({ sign: true, reason: "auto" }).catch((error) => {
      console.error("[签到] 补签失败", error.message);
    });
  }
}

function expireSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 3 * 60 * 1000 && session.status !== "confirmed") {
      sessions.delete(id);
    }
  }
}

async function finishLogin(session, scanned) {
  if (session.done) return session.done;
  session.done = (async () => {
    session.deviceFp = await registerDeviceFp(session.deviceId);
    const device = { deviceId: session.deviceId, deviceFp: session.deviceFp };
    const tokens = await exchangeGameToken(device, scanned.uid, scanned.gameToken);
    const web = await exchangeWebTokens(device, tokens.stoken, tokens.mid);
    const now = new Date().toISOString();
    let saved;
    await store.update((data) => {
      const existing = data.accounts.find((account) => account.stuid === tokens.stuid);
      const account = existing || {
        id: randomUUID(),
        createdAt: now,
        roles: [],
        enabled: true,
      };
      Object.assign(account, {
        stuid: tokens.stuid,
        mid: tokens.mid,
        stoken: tokens.stoken,
        ltoken: web.ltoken,
        cookieToken: web.cookieToken,
        deviceId: session.deviceId,
        deviceFp: session.deviceFp,
        authOk: true,
        authMessage: "",
        updatedAt: now,
      });
      if (!existing) data.accounts.push(account);
      saved = account;
      return data;
    });
    const data = await store.read();
    const signNow = isPastSlot(data.settings.hour, data.settings.minute);
    const results = await runner.run({
      sign: signNow,
      accountId: saved.id,
      reason: "login",
    });
    const failed = results.find((item) => !item.ok);
    session.status = "confirmed";
    session.message = failed ? failed.message : signNow ? "登录成功，已尝试签到" : "登录成功";
    const latest = await store.read();
    session.account = toPublic(latest.accounts.find((account) => account.id === saved.id));
    return session;
  })().catch((error) => {
    session.done = null;
    session.status = "error";
    session.message = error.message || "登录失败";
    throw error;
  });
  return session.done;
}

const authFile = path.join(dataDir, "auth.json");
let gate;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const loginFailures = new Map();

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || "local";
}

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  if (req.path === "/api/health" || req.path === "/api/auth/login" || req.path === "/api/auth/session" || req.path === "/api/auth/logout") {
    return next();
  }
  if (!gate?.readRequest(req)) {
    res.status(401).json({ message: "请先登录" });
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/session", (req, res) => {
  res.json({ ok: Boolean(gate?.readRequest(req)) });
});

app.post("/api/auth/login", (req, res) => {
  const key = clientKey(req);
  const failure = loginFailures.get(key);
  if (failure && failure.count >= 8 && Date.now() - failure.at < 60_000) {
    res.status(429).json({ message: "试得太勤了，请一分钟后再登录" });
    return;
  }
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  if (!gate.login(username, password)) {
    const count = failure && Date.now() - failure.at < 60_000 ? failure.count + 1 : 1;
    loginFailures.set(key, { count, at: Date.now() });
    res.status(401).json({ message: "用户名或密码不正确" });
    return;
  }
  loginFailures.delete(key);
  res.setHeader("Set-Cookie", gate.cookie(username));
  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.setHeader("Set-Cookie", gate.clearCookie());
  res.json({ ok: true });
});

async function rememberPagePassword(password) {
  const notes = path.join(dataDir, "本地记录.md");
  try {
    const text = await readFile(notes, "utf8");
    const next = text.replace(/^- 密码：.*$/m, `- 密码：\`${password}\``);
    if (next === text) return;
    await writeFile(notes, next, { mode: 0o600 });
  } catch {
    // 没有本地记录时，密码只保存在 auth.json。
  }
}

app.post("/api/auth/password", async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 8 || newPassword.length > 64) {
    res.status(400).json({ message: "新密码请用 8 到 64 个字符" });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ message: "新密码要和当前密码不一样" });
    return;
  }
  const next = await changeGatePassword(authFile, currentPassword, newPassword);
  if (!next) {
    res.status(401).json({ message: "当前密码不正确" });
    return;
  }
  gate = next;
  await rememberPagePassword(newPassword);
  res.setHeader("Set-Cookie", gate.cookie(gate.username));
  res.json({ ok: true });
});

app.get("/api/state", async (_req, res, next) => {
  try {
    res.json(publicState(await store.read()));
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", async (req, res, next) => {
  try {
    const time = clampTime(req.body?.hour, req.body?.minute);
    const data = await store.update((current) => {
      current.settings.hour = time.hour;
      current.settings.minute = time.minute;
      return current;
    });
    await schedule();
    res.json(publicState(data));
  } catch (error) {
    if (error.message?.includes("小时") || error.message?.includes("分钟")) {
      res.status(400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/login/qr", async (_req, res, next) => {
  try {
    expireSessions();
    const device = newDevice();
    const qr = await createQr(device.deviceId);
    const session = {
      id: randomUUID(),
      ...device,
      ticket: qr.ticket,
      url: qr.url,
      status: "pending",
      message: "等待扫码",
      createdAt: Date.now(),
    };
    sessions.set(session.id, session);
    res.json({ sessionId: session.id, url: session.url, expiresAt: session.createdAt + 3 * 60 * 1000 });
  } catch (error) {
    next(error);
  }
});

function maskPhone(phone) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function cleanSmsSessions() {
  const now = Date.now();
  for (const [id, session] of smsSessions) {
    if (now - session.createdAt > 10 * 60 * 1000) smsSessions.delete(id);
  }
}

function validGeetest(value) {
  if (!value || typeof value !== "object") return false;
  return ["geetest_challenge", "geetest_validate", "geetest_seccode"].every((key) => {
    const field = value[key];
    return typeof field === "string" && field.length > 0 && field.length < 512;
  });
}

async function finishSmsLogin(session) {
  const web = await exchangeWebTokens(session.device, session.stoken, session.mid);
  const now = new Date().toISOString();
  let saved;
  await store.update((data) => {
    const existing = data.accounts.find((account) => account.stuid === session.stuid);
    const account = existing || {
      id: randomUUID(),
      createdAt: now,
      roles: [],
      enabled: true,
    };
    Object.assign(account, {
      stuid: session.stuid,
      mid: session.mid,
      stoken: session.stoken,
      ltoken: web.ltoken,
      cookieToken: web.cookieToken,
      deviceId: session.device.deviceId,
      deviceFp: session.device.deviceFp,
      authOk: true,
      authMessage: "",
      updatedAt: now,
    });
    if (!existing) data.accounts.push(account);
    saved = account;
    return data;
  });
  const data = await store.read();
  const results = await runner.run({
    sign: isPastSlot(data.settings.hour, data.settings.minute),
    accountId: saved.id,
    reason: "login",
  });
  const failed = results.find((item) => !item.ok);
  const latest = await store.read();
  return {
    message: failed ? failed.message : "登录成功",
    account: toPublic(latest.accounts.find((account) => account.id === saved.id)),
  };
}

app.post("/api/login/sms/send", async (req, res, next) => {
  try {
    cleanSmsSessions();
    const phone = String(req.body?.phone || "").trim();
    if (!/^1\d{10}$/.test(phone)) {
      res.status(400).json({ message: "请输入 11 位手机号" });
      return;
    }
    const waited = Date.now() - (smsSentAt.get(phone) || 0);
    if (waited < 60_000) {
      res.status(429).json({ message: `验证码刚发过，请 ${Math.ceil((60_000 - waited) / 1000)} 秒后再试` });
      return;
    }
    const device = newDevice();
    device.deviceFp = await registerDeviceFp(device.deviceId);
    const detail = await sendLoginCode(device, phone);
    const captcha = parseAigis(detail.aigis);
    const session = {
      id: randomUUID(),
      device,
      phone,
      createdAt: Date.now(),
      captchaSession: captcha?.sessionId || "",
    };
    smsSessions.set(session.id, session);
    if (detail.json.retcode === 0) {
      smsSentAt.set(phone, Date.now());
      res.json({ sessionId: session.id, status: "code", phoneMask: maskPhone(phone), message: "验证码已发送" });
      return;
    }
    if (captcha) {
      res.json({
        sessionId: session.id,
        status: "captcha",
        phoneMask: maskPhone(phone),
        gt: captcha.gt,
        challenge: captcha.challenge,
        newCaptcha: captcha.newCaptcha,
        message: "请先完成安全验证，验证通过后才会发短信",
      });
      return;
    }
    smsSessions.delete(session.id);
    console.error("[登录] 短信发送失败", detail.json.retcode, detail.json.message);
    res.status(400).json({ message: detail.json.message || "验证码没有发出去" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login/sms/captcha", async (req, res, next) => {
  try {
    const session = smsSessions.get(req.body?.sessionId);
    if (!session) {
      res.status(404).json({ message: "登录已过期，请重新获取验证码" });
      return;
    }
    if (!session.captchaSession || !validGeetest(req.body?.geetest)) {
      res.status(400).json({ message: "安全验证结果不完整" });
      return;
    }
    const detail = await sendLoginCode(session.device, session.phone, aigisHeader(session.captchaSession, req.body.geetest));
    const captcha = parseAigis(detail.aigis);
    if (detail.json.retcode === 0) {
      smsSentAt.set(session.phone, Date.now());
      session.captchaSession = "";
      res.json({ status: "code", phoneMask: maskPhone(session.phone), message: "验证码已发送" });
      return;
    }
    if (captcha) {
      session.captchaSession = captcha.sessionId;
      res.json({
        status: "captcha",
        gt: captcha.gt,
        challenge: captcha.challenge,
        newCaptcha: captcha.newCaptcha,
        message: "安全验证没通过，请再试一次",
      });
      return;
    }
    console.error("[登录] 短信验证后发送失败", detail.json.retcode, detail.json.message);
    res.status(400).json({ message: detail.json.message || "验证码没有发出去" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login/sms/verify", async (req, res, next) => {
  try {
    const session = smsSessions.get(req.body?.sessionId);
    if (!session) {
      res.status(404).json({ message: "登录已过期，请重新获取验证码" });
      return;
    }
    const code = String(req.body?.code || "").trim();
    if (!/^\d{4,8}$/.test(code)) {
      res.status(400).json({ message: "请输入短信里的验证码" });
      return;
    }
    const tokens = await loginByPhoneCode(session.device, session.phone, code);
    Object.assign(session, tokens);
    const result = await finishSmsLogin(session);
    smsSessions.delete(session.id);
    res.json({ status: "confirmed", ...result });
  } catch (error) {
    console.error("[登录] 验证码登录失败", error.message);
    res.status(400).json({ message: error.message || "验证码登录失败" });
  }
});

app.get("/api/login/qr/:id", async (req, res, next) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ message: "二维码不存在或已过期" });
      return;
    }
    if (session.status === "confirmed" && session.account) {
      res.json({ status: "confirmed", message: session.message, account: session.account });
      return;
    }
    if (Date.now() - session.createdAt > 3 * 60 * 1000) {
      session.status = "expired";
      session.message = "二维码已失效，请刷新";
      res.json({ status: session.status, message: session.message });
      return;
    }
    const scanned = await queryQr(session.deviceId, session.ticket);
    if (scanned.status !== "confirmed") {
      session.status = scanned.status;
      session.message = scanned.message;
      res.json({ status: session.status, message: session.message });
      return;
    }
    try {
      await finishLogin(session, scanned);
      res.json({ status: "confirmed", message: session.message, account: session.account });
    } catch (error) {
      res.json({ status: "error", message: error.message || "登录失败" });
    }
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:id", async (req, res, next) => {
  try {
    const data = await store.read();
    const account = data.accounts.find((item) => item.id === req.params.id);
    if (!account) {
      res.status(404).json({ message: "找不到这个账号" });
      return;
    }
    if (typeof req.body?.enabled === "boolean") account.enabled = req.body.enabled;
    if (typeof req.body?.nickname === "string") {
      const nickname = req.body.nickname.trim();
      if (!nickname || nickname.length > 20) {
        res.status(400).json({ message: "备注请控制在 1 到 20 个字" });
        return;
      }
      account.nickname = nickname;
    }
    if (req.body?.roles && typeof req.body.roles === "object") {
      for (const role of account.roles || []) {
        if (typeof req.body.roles[role.gameUid] === "boolean") {
          role.enabled = req.body.roles[role.gameUid];
        }
      }
    }
    await store.update(() => data);
    res.json({ account: toPublic(account) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", async (req, res, next) => {
  try {
    const data = await store.read();
    const before = data.accounts.length;
    data.accounts = data.accounts.filter((account) => account.id !== req.params.id);
    if (data.accounts.length === before) {
      res.status(404).json({ message: "找不到这个账号" });
      return;
    }
    await store.update(() => data);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/checkin", async (req, res, next) => {
  try {
    const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : "";
    const results = await runner.run({ sign: true, accountId, reason: "manual" });
    const data = await store.read();
    res.json({ results, ...publicState(data) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/refresh", async (_req, res, next) => {
  try {
    await runner.run({ sign: false, reason: "refresh" });
    res.json(publicState(await store.read()));
  } catch (error) {
    next(error);
  }
});

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^[^.]*$/, (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distDir, "index.html"), (error) => {
      if (error) next();
    });
  });
}

app.use((error, _req, res, _next) => {
  const message = error.name === "TimeoutError" ? "连接米哈游超时" : error.message || "服务出错了";
  console.error("[服务]", message);
  res.status(500).json({ message });
});

try {
  gate = await loadGate(authFile);
} catch {
  const username = process.env.AUTH_USERNAME || "admin";
  const password = process.env.AUTH_PASSWORD || randomBytes(12).toString("base64url");
  await createGateFile(authFile, { username, password });
  gate = await loadGate(authFile);
  await appendFile(
    path.join(dataDir, "本地记录.md"),
    `\n\n## 自动生成的页面登录\n\n- 用户名：${username}\n- 密码：${password}\n`,
    { mode: 0o600 },
  );
  console.log("[登录] 已生成本机访问账号，写在 data/本地记录.md");
}

const server = app.listen(port, host, () => {
  console.log(`签到助手 http://${host}:${port}`);
  schedule().catch((error) => console.error("[签到] 调度失败", error.message));
});

server.on("error", (error) => {
  console.error("[服务] 启动失败", error.message);
  process.exit(1);
});
