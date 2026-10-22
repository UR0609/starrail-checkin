import { exchangeWebTokens, fetchAwards, fetchRoles, fetchSignInfo, mapRole, postSign } from "./mihoyo.js";
import { interpretInfo, interpretSignResult, mergeSignedDates, previewFromInfo } from "./sign.js";
import { shanghaiDate } from "./time.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stamp(role, patch) {
  return { ...role, ...patch, checkedAt: new Date().toISOString() };
}

function rememberSignedDates(role, infoData, signedNow) {
  const already = Boolean(infoData?.is_sign);
  role.signedDates = mergeSignedDates(role.signedDates, {
    today: infoData?.today || (signedNow ? shanghaiDate() : ""),
    is_sign: already || signedNow,
    total_sign_day: already ? Number(infoData?.total_sign_day || 0) : Number(infoData?.total_sign_day || 0) + (signedNow ? 1 : 0),
    sign_cnt_missed: infoData?.sign_cnt_missed,
  });
}

async function refreshTokens(account) {
  const tokens = await exchangeWebTokens(
    { deviceId: account.deviceId, deviceFp: account.deviceFp },
    account.stoken,
    account.mid,
  );
  account.ltoken = tokens.ltoken || account.ltoken;
  account.cookieToken = tokens.cookieToken;
  account.authOk = true;
  account.authMessage = "";
}

function authDeadResult(result) {
  return Boolean(result?.authDead || result?.retcode === -100 || result?.retcode === -10001);
}

async function withAuthRetry(account, run) {
  let result = await run();
  if (authDeadResult(result) && account.stoken && account.mid) {
    try {
      await refreshTokens(account);
      result = await run();
    } catch (error) {
      account.authOk = false;
      account.authMessage = error.message || "登录已失效，请重新扫码";
      return result;
    }
  }
  if (authDeadResult(result)) {
    account.authOk = false;
    account.authMessage = "登录已失效，请重新扫码";
  }
  return result;
}

function applyRoles(account, list) {
  const previous = new Map((account.roles || []).map((role) => [role.gameUid, role]));
  account.roles = list.map((raw) => mapRole(raw, previous.get(String(raw.game_uid))));
  account.authOk = true;
  account.authMessage = "";
  if (!account.nickname) {
    account.nickname = account.roles[0]?.nickname || `账号${String(account.stuid).slice(-4)}`;
  }
}

export async function checkinAccount(account, { sign = true, pause = sleep } = {}) {
  const results = [];
  let rolesJson;
  try {
    rolesJson = await withAuthRetry(account, () => fetchRoles(account));
  } catch (error) {
    const message = error.name === "TimeoutError" ? "连接米哈游超时" : error.message || "获取角色失败";
    account.authMessage = message;
    return [
      {
        accountId: account.id,
        nickname: account.nickname,
        gameUid: "",
        ok: false,
        definitive: false,
        message,
      },
    ];
  }

  if (!rolesJson || rolesJson.retcode !== 0) {
    const message = account.authOk === false
      ? account.authMessage || "登录已失效，请重新扫码"
      : rolesJson?.message || "获取角色列表失败";
    return [
      {
        accountId: account.id,
        nickname: account.nickname,
        gameUid: "",
        ok: false,
        definitive: account.authOk === false,
        message,
      },
    ];
  }

  applyRoles(account, rolesJson.data?.list || []);

  if (!account.roles?.length) {
    return [
      {
        accountId: account.id,
        nickname: account.nickname,
        gameUid: "",
        ok: false,
        definitive: true,
        message: "这个米游社账号还没有绑定星穹铁道角色",
      },
    ];
  }

  let awards = [];
  try {
    awards = await fetchAwards(account);
  } catch {
    awards = [];
  }

  const targets = sign ? account.roles.filter((role) => role.enabled !== false) : account.roles;
  if (sign && targets.length === 0) {
    return [
      {
        accountId: account.id,
        nickname: account.nickname,
        gameUid: "",
        ok: true,
        definitive: true,
        message: "这些角色都已关闭自动签到",
      },
    ];
  }
  for (const role of targets) {
    try {
      const info = await withAuthRetry(account, () => fetchSignInfo(account, role));
      const infoResult = interpretInfo(info);
      if (!infoResult.ok) {
        Object.assign(role, stamp(role, {
          isSign: false,
          message: infoResult.message,
        }));
        results.push({
          accountId: account.id,
          nickname: role.nickname,
          gameUid: role.gameUid,
          ok: false,
          definitive: Boolean(infoResult.definitive),
          message: infoResult.message,
        });
        continue;
      }
      if (!sign || infoResult.data.is_sign) {
        const preview = previewFromInfo(infoResult.data, awards);
        if (infoResult.data.is_sign) rememberSignedDates(role, infoResult.data, false);
        Object.assign(role, stamp(role, {
          ...preview,
          message: infoResult.data.is_sign ? "今天已经签过了" : "今天还没签",
        }));
        results.push({
          accountId: account.id,
          nickname: role.nickname,
          gameUid: role.gameUid,
          ok: true,
          definitive: true,
          message: role.message,
          reward: role.reward,
        });
        continue;
      }
      const body = await withAuthRetry(account, () => postSign(account, role));
      const signed = interpretSignResult(infoResult.data, body, awards);
      if (signed.isSign) rememberSignedDates(role, infoResult.data, true);
      Object.assign(role, stamp(role, {
        isSign: Boolean(signed.isSign),
        totalSignDay: signed.totalSignDay || 0,
        reward: signed.reward || "",
        rewardIcon: signed.rewardIcon || "",
        message: signed.message,
      }));
      results.push({
        accountId: account.id,
        nickname: role.nickname,
        gameUid: role.gameUid,
        ok: signed.ok,
        definitive: signed.definitive,
        message: signed.message,
        reward: signed.reward || "",
      });
    } catch (error) {
      const message = error.name === "TimeoutError" ? "连接米哈游超时" : error.message || "签到失败";
      Object.assign(role, stamp(role, { message }));
      results.push({
        accountId: account.id,
        nickname: role.nickname,
        gameUid: role.gameUid,
        ok: false,
        definitive: false,
        message,
      });
    }
    await pause(1200);
  }

  for (const role of account.roles) {
    if (!targets.includes(role) && !role.message) role.message = "已关闭自动签到";
  }
  return results;
}

export function pushHistory(data, results) {
  const at = new Date().toISOString();
  for (const result of results) {
    data.history.unshift({
      id: `${at}-${result.accountId}-${result.gameUid}`,
      at,
      accountId: result.accountId,
      nickname: result.nickname,
      gameUid: result.gameUid,
      ok: result.ok,
      message: result.message,
      reward: result.reward || "",
    });
  }
  data.history = data.history.slice(0, 300);
}

export function createRunner(store) {
  let tail = Promise.resolve();

  function run({ sign = true, accountId = "", reason = "manual" } = {}) {
    const job = tail.then(async () => {
      const data = await store.read();
      const selected = data.accounts.filter((account) => {
        if (accountId) return account.id === accountId;
        if (!sign) return true;
        return account.enabled !== false;
      });
      const results = [];
      for (const account of selected) {
        const part = await checkinAccount(account, { sign });
        results.push(...part);
        if (sign && selected.length > 1) await sleep(800);
      }
      await store.update((latest) => {
        for (const account of selected) {
          const index = latest.accounts.findIndex((item) => item.id === account.id);
          if (index >= 0) latest.accounts[index] = account;
        }
        if (sign) pushHistory(latest, results);
        if (reason === "auto" && !accountId && results.some((item) => item.definitive)) {
          latest.settings.lastAutoDate = shanghaiDate();
        }
        return latest;
      });
      if (sign) {
        for (const result of results) {
          console.log(`[签到] ${result.nickname || "账号"} ${result.gameUid} ${result.message}`);
        }
      }
      return results;
    });
    tail = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  return { run };
}
