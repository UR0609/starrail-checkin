import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gameTokenBody, k2Ds, passportDs, webDs, x4Ds } from "./ds.js";
import { rsaEncrypt } from "./rsa.js";

const QR_FETCH = "https://hk4e-sdk.mihoyo.com/hk4e_cn/combo/panda/qrcode/fetch";
const QR_QUERY = "https://hk4e-sdk.mihoyo.com/hk4e_cn/combo/panda/qrcode/query";
const TOKEN_BY_GAME = "https://api-takumi.mihoyo.com/account/ma-cn-session/app/getTokenByGameToken";
const FP_URL = "https://public-data-api.mihoyo.com/device-fp/api/getFp";
const SEND_CODE_URL = "https://passport-api.mihoyo.com/account/ma-cn-verifier/verifier/createLoginCaptcha";
const LOGIN_PHONE_URL = "https://passport-api.mihoyo.com/account/ma-cn-passport/app/loginByMobileCaptcha";
const LTOKEN_URL = "https://passport-api.mihoyo.com/account/auth/api/getLTokenBySToken";
const COOKIE_URL = "https://passport-api.mihoyo.com/account/auth/api/getCookieAccountInfoBySToken";
const ROLES_URL = "https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie";
const HOME_URL = "https://api-takumi.mihoyo.com/event/luna/home";
const INFO_URL = "https://api-takumi.mihoyo.com/event/luna/info";
const SIGN_URL = "https://api-takumi.mihoyo.com/event/luna/sign";

export const ACT_ID = "e202304121516551";
export const APP_ID = "8";
const TOKEN_VERSION = "2.102.1";
const PASSPORT_VERSION = "2.81.1";
const SIGN_VERSION = "2.109.0";
const APP_PASSPORT = "bll8iq97cem8";

const TOKEN_UA = `Mozilla/5.0 (Linux; Android 12) Mobile miHoYoBBS/${TOKEN_VERSION}`;
const PASSPORT_UA =
  "Mozilla/5.0 (Linux; Android 13; 22011211C Build/TP1A.220624.014; wv) AppleWebKit/537.36 " +
  `(KHTML, like Gecko) Version/4.0 Chrome/104.0.5112.97 Mobile Safari/537.36 miHoYoBBS/${PASSPORT_VERSION}`;
const SIGN_UA =
  "Mozilla/5.0 (Linux; Android 12; Unspecified Device) AppleWebKit/537.36 (KHTML, like Gecko) " +
  `Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 miHoYoBBS/${SIGN_VERSION}`;

const REGION_NAMES = {
  prod_gf_cn: "星穹列车",
};

export function newDevice() {
  return {
    deviceId: randomUUID().toUpperCase(),
    deviceFp: randomBytes(7).toString("hex").slice(0, 13),
  };
}

async function requestDetail(url, { method = "GET", headers = {}, body, timeout = 20000 } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { retcode: -1, message: "米哈游返回了无法解析的内容" };
  }
  if (response.status === 429) json.status = 429;
  return { json, aigis: response.headers.get("x-rpc-aigis") || "" };
}

async function request(url, options) {
  return (await requestDetail(url, options)).json;
}

function androidExt(deviceId) {
  const hex = createHash("sha256").update(String(deviceId)).digest("hex");
  return {
    cpuType: "arm64-v8a",
    romCapacity: "256",
    productName: "rubens",
    romRemain: "180",
    manufacturer: "Xiaomi",
    appMemory: "512",
    hostname: "xiaomi",
    screenSize: "1080x2400",
    osVersion: "13",
    aaid: randomUUID(),
    vendor: "中国移动",
    accelerometer: "0.01x0.02x9.80",
    buildTags: "release-keys",
    model: "22011211C",
    brand: "Xiaomi",
    oaid: hex.slice(0, 16),
    hardware: "qcom",
    deviceType: "rubens",
    devId: "REL",
    serialNumber: "unknown",
    buildTime: "1670000000000",
    buildUser: "builder",
    ramCapacity: "114690",
    magnetometer: "1x2x3",
    display: "TP1A.220624.014",
    ramRemain: "60000",
    deviceInfo: "Xiaomi/rubens/rubens:13/TP1A.220624.014/V14.0.4.0.TLNCNXM:user/release-keys",
    gyroscope: "0.001x0.001x0.001",
    vaid: hex.slice(16, 32),
    buildType: "user",
    sdkVersion: "33",
    board: "taro",
  };
}

export async function registerDeviceFp(deviceId) {
  const body = JSON.stringify({
    device_id: deviceId,
    seed_id: randomUUID(),
    seed_time: String(Date.now()),
    platform: "2",
    device_fp: randomBytes(7).toString("hex").slice(0, 13),
    app_name: "bbs_cn",
    ext_fields: JSON.stringify(androidExt(deviceId)),
  });
  const json = await request(FP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": PASSPORT_UA,
      "x-rpc-device_id": deviceId,
      "x-rpc-app_version": PASSPORT_VERSION,
      "x-rpc-client_type": "2",
    },
    body,
  });
  if (json.retcode !== 0 || !json.data?.device_fp) {
    throw new Error(json.message || "设备验证没有通过");
  }
  return json.data.device_fp;
}

function passportHeaders(device, extra = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": PASSPORT_UA,
    Referer: "https://app.mihoyo.com",
    "x-rpc-app_version": PASSPORT_VERSION,
    "x-rpc-app_id": APP_PASSPORT,
    "x-rpc-verify_key": APP_PASSPORT,
    "x-rpc-client_type": "2",
    "x-rpc-device_id": device.deviceId,
    "x-rpc-device_fp": device.deviceFp || "",
    "x-rpc-device_name": "Xiaomi 22011211C",
    "x-rpc-device_model": "22011211C",
    "x-rpc-sys_version": "13",
    "x-rpc-channel": "miyousheluodi",
    DS: passportDs(),
    ...extra,
  };
}

export function parseAigis(header) {
  if (!header) return null;
  let parsed;
  try {
    parsed = JSON.parse(header);
  } catch {
    return null;
  }
  let data = parsed.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!parsed.session_id || !data?.gt || !data?.challenge) return null;
  return {
    sessionId: String(parsed.session_id),
    gt: String(data.gt),
    challenge: String(data.challenge),
    newCaptcha: data.new_captcha !== 0,
  };
}

export function aigisHeader(sessionId, geetest) {
  const payload = JSON.stringify({
    geetest_challenge: geetest.geetest_challenge,
    geetest_validate: geetest.geetest_validate,
    geetest_seccode: geetest.geetest_seccode,
  });
  return `${sessionId};${Buffer.from(payload).toString("base64")}`;
}

export async function sendLoginCode(device, phone, aigis = "") {
  const body = JSON.stringify({
    area_code: rsaEncrypt("+86"),
    mobile: rsaEncrypt(phone),
  });
  const headers = passportHeaders(device);
  if (aigis) headers["x-rpc-aigis"] = aigis;
  return requestDetail(SEND_CODE_URL, { method: "POST", headers, body });
}

export async function loginByPhoneCode(device, phone, code) {
  const body = JSON.stringify({
    area_code: rsaEncrypt("+86"),
    mobile: rsaEncrypt(phone),
    action_type: "login_by_mobile_captcha",
    captcha: code,
  });
  const json = await request(LOGIN_PHONE_URL, {
    method: "POST",
    headers: passportHeaders(device),
    body,
  });
  if (json.retcode !== 0) throw new Error(json.message || "验证码登录失败");
  const stoken = json.data?.token?.token || "";
  const mid = json.data?.user_info?.mid || "";
  const stuid = String(json.data?.user_info?.aid || "");
  if (!stoken || !mid || !stuid) throw new Error("登录凭证不完整");
  return { stoken, mid, stuid };
}

export async function createQr(deviceId) {
  const json = await request(QR_FETCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ app_id: APP_ID, device: deviceId }),
  });
  if (json.retcode !== 0 || !json.data?.url) {
    throw new Error(json.message || "生成二维码失败");
  }
  const url = json.data.url;
  const ticket = new URL(url).searchParams.get("ticket") || "";
  if (!ticket) throw new Error("二维码里没有 ticket");
  return { url, ticket };
}

export async function queryQr(deviceId, ticket) {
  const json = await request(QR_QUERY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ app_id: APP_ID, device: deviceId, ticket }),
    timeout: 15000,
  });
  if (json.retcode === -3501) return { status: "expired", message: "二维码已失效，请刷新" };
  if (json.retcode === -3505) return { status: "cancelled", message: "手机上取消了登录" };
  if (json.retcode !== 0) {
    return { status: "error", message: json.message || "查询二维码失败" };
  }
  const stat = json.data?.stat || json.data?.status || "";
  if (stat === "Init" || stat === "Created") return { status: "pending", message: "等待扫码" };
  if (stat === "Scanned") return { status: "scanned", message: "已扫码，请在手机上确认" };
  if (stat === "Confirmed") {
    const raw = json.data?.payload?.raw || "{}";
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { status: "error", message: "登录结果解析失败" };
    }
    if (!payload.uid || !payload.token) return { status: "error", message: "登录结果缺少凭证" };
    return { status: "confirmed", uid: String(payload.uid), gameToken: String(payload.token) };
  }
  return { status: "pending", message: "等待扫码" };
}

function tokenHeaders(device, ds, extra = {}) {
  return {
    "user-agent": TOKEN_UA,
    "x-rpc-device_id": device.deviceId,
    "x-rpc-device_fp": device.deviceFp,
    ds,
    ...extra,
  };
}

export async function exchangeGameToken(device, uid, gameToken) {
  const body = gameTokenBody(uid, gameToken);
  const json = await request(TOKEN_BY_GAME, {
    method: "POST",
    headers: tokenHeaders(device, k2Ds(body), {
      "content-type": "application/json",
      "x-rpc-app_id": APP_PASSPORT,
      "x-rpc-client_type": "2",
      "x-rpc-game_biz": "bbs_cn",
      "x-rpc-device_name": "Xiaomi 22011211C",
      "x-rpc-device_model": "22011211C",
      "x-rpc-sys_version": "13",
      "x-rpc-channel": "miyousheluodi",
    }),
    body,
  });
  if (json.retcode !== 0) throw new Error(json.message || "换取登录凭证失败");
  const stoken = json.data?.token?.token || "";
  const mid = json.data?.user_info?.mid || "";
  const aid = String(json.data?.user_info?.aid || uid);
  if (!stoken || !mid) throw new Error("登录凭证不完整");
  return { stoken, mid, stuid: aid };
}

async function tokenByStoken(device, url, stoken, mid) {
  const query = `stoken=${stoken}`;
  const endpoint = new URL(url);
  endpoint.searchParams.set("stoken", stoken);
  return request(endpoint, {
    headers: tokenHeaders(device, x4Ds(query), {
      "x-rpc-app_version": TOKEN_VERSION,
      "x-rpc-client_type": "5",
      "x-requested-with": "com.mihoyo.hyperion",
      referer: "https://webstatic.mihoyo.com",
      cookie: `mid=${mid};stoken=${stoken}`,
    }),
  });
}

export async function exchangeWebTokens(device, stoken, mid) {
  const [ltokenJson, cookieJson] = await Promise.all([
    tokenByStoken(device, LTOKEN_URL, stoken, mid),
    tokenByStoken(device, COOKIE_URL, stoken, mid),
  ]);
  if (cookieJson.retcode !== 0 || !cookieJson.data?.cookie_token) {
    throw new Error(cookieJson.message || "换取签到凭证失败");
  }
  return {
    ltoken: ltokenJson.retcode === 0 ? ltokenJson.data?.ltoken || "" : "",
    cookieToken: cookieJson.data.cookie_token,
  };
}

export function cookieHeader(account) {
  const parts = [
    `account_id=${account.stuid}`,
    `account_id_v2=${account.stuid}`,
    `account_mid_v2=${account.mid}`,
    `cookie_token=${account.cookieToken}`,
    `ltmid_v2=${account.mid}`,
    `ltuid=${account.stuid}`,
    `ltuid_v2=${account.stuid}`,
  ];
  if (account.ltoken) parts.push(`ltoken=${account.ltoken}`);
  return parts.join("; ");
}

export function signHeaders(account) {
  return {
    Accept: "application/json, text/plain, */*",
    DS: webDs(),
    "x-rpc-channel": "miyousheluodi",
    Origin: "https://act.mihoyo.com",
    "x-rpc-app_version": SIGN_VERSION,
    "User-Agent": SIGN_UA,
    "x-rpc-client_type": "5",
    Referer: "https://act.mihoyo.com/",
    "Accept-Language": "zh-CN,en-US;q=0.8",
    "X-Requested-With": "com.mihoyo.hyperion",
    Cookie: cookieHeader(account),
    "x-rpc-device_id": account.deviceId,
  };
}

export function mapRole(raw, previous = {}) {
  return {
    gameUid: String(raw.game_uid),
    nickname: raw.nickname || "开拓者",
    region: raw.region || "",
    regionName: raw.region_name || REGION_NAMES[raw.region] || raw.region || "未知服务器",
    level: Number(raw.level || 0),
    enabled: previous.enabled !== false,
    isSign: previous.isSign || false,
    totalSignDay: previous.totalSignDay || 0,
    reward: previous.reward || "",
    rewardIcon: previous.rewardIcon || "",
    message: previous.message || "",
    checkedAt: previous.checkedAt || "",
    signedDates: Array.isArray(previous.signedDates) ? previous.signedDates : [],
  };
}

export async function fetchRoles(account) {
  const url = new URL(ROLES_URL);
  url.searchParams.set("game_biz", "hkrpg_cn");
  const json = await request(url, { headers: signHeaders(account) });
  return json;
}

export async function fetchAwards(account) {
  const url = new URL(HOME_URL);
  url.searchParams.set("lang", "zh-cn");
  url.searchParams.set("act_id", ACT_ID);
  const json = await request(url, { headers: signHeaders(account) });
  if (json.retcode !== 0) return [];
  return json.data?.awards || [];
}

export async function fetchSignInfo(account, role) {
  const url = new URL(INFO_URL);
  url.searchParams.set("lang", "zh-cn");
  url.searchParams.set("act_id", ACT_ID);
  url.searchParams.set("region", role.region);
  url.searchParams.set("uid", role.gameUid);
  return request(url, { headers: signHeaders(account) });
}

export async function postSign(account, role) {
  return request(SIGN_URL, {
    method: "POST",
    headers: { ...signHeaders(account), "Content-Type": "application/json" },
    body: JSON.stringify({ act_id: ACT_ID, region: role.region, uid: role.gameUid }),
  });
}
