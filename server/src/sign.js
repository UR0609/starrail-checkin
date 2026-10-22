const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Keep observed sign-in dates. Fill the whole month only when miHoYo says nothing was missed. */
export function mergeSignedDates(existing, info) {
  const set = new Set((existing || []).filter((date) => DATE_RE.test(date)));
  const today = info?.today;
  if (!DATE_RE.test(today || "")) return [...set].sort();
  const day = Number(today.slice(8, 10));
  const signedToday = Boolean(info.is_sign);
  if (signedToday) set.add(today);
  const total = Number(info.total_sign_day || 0);
  const elapsed = signedToday ? day : day - 1;
  if (info.sign_cnt_missed === 0 && total === elapsed && elapsed > 0) {
    const prefix = today.slice(0, 8);
    for (let cursor = 1; cursor <= elapsed; cursor += 1) {
      set.add(`${prefix}${String(cursor).padStart(2, "0")}`);
    }
  }
  return [...set].sort();
}

export function rewardOf(awards, index) {
  if (!Array.isArray(awards) || index < 0 || index >= awards.length) {
    return { reward: "", rewardIcon: "" };
  }
  const item = awards[index] || {};
  const name = item.name || "奖励";
  const count = item.cnt ?? item.count;
  return {
    reward: count ? `${name} ×${count}` : name,
    rewardIcon: typeof item.icon === "string" ? item.icon : "",
  };
}

export function previewFromInfo(info, awards) {
  const total = Number(info?.total_sign_day || 0);
  const signed = Boolean(info?.is_sign);
  const reward = rewardOf(awards, signed ? total - 1 : total);
  return { ...reward, totalSignDay: total, isSign: signed };
}

export function interpretInfo(info) {
  if (!info || info.retcode === undefined) {
    return { ok: false, definitive: false, message: "没有拿到签到状态" };
  }
  if (info.retcode === -100 || info.retcode === -10001) {
    return { ok: false, definitive: true, authDead: true, message: "登录已失效，请重新扫码" };
  }
  if (info.retcode !== 0) {
    return { ok: false, definitive: false, message: info.message || "获取签到状态失败" };
  }
  if (info.data?.first_bind) {
    return {
      ok: false,
      definitive: true,
      isSign: false,
      totalSignDay: Number(info.data.total_sign_day || 0),
      message: "这是第一次绑定，请先在米游社里手动签到一次",
    };
  }
  return { ok: true, data: info.data };
}

export function interpretSignResult(infoData, body, awards) {
  const total = Number(infoData?.total_sign_day || 0);
  if (body?.status === 429) {
    return {
      ok: false,
      definitive: false,
      isSign: false,
      totalSignDay: total,
      message: "请求太频繁，稍后再试",
      reward: "",
      rewardIcon: "",
    };
  }
  if (body?.retcode === -5003) {
    return {
      ok: true,
      definitive: true,
      isSign: true,
      totalSignDay: total,
      message: "今天已经签过了",
      ...rewardOf(awards, total - 1),
    };
  }
  if (body?.retcode === -100 || body?.retcode === -10001) {
    return {
      ok: false,
      definitive: true,
      authDead: true,
      isSign: false,
      totalSignDay: total,
      message: "登录已失效，请重新扫码",
      reward: "",
      rewardIcon: "",
    };
  }
  if (body?.retcode === 0) {
    const success = body?.data?.success;
    if (success === 1 || success === "1") {
      return {
        ok: false,
        definitive: true,
        captcha: true,
        isSign: false,
        totalSignDay: total,
        message: "米哈游要求验证码，请打开米游社手动签到一次",
        reward: "",
        rewardIcon: "",
      };
    }
    return {
      ok: true,
      definitive: true,
      isSign: true,
      totalSignDay: total + 1,
      message: "签到成功",
      ...rewardOf(awards, total),
    };
  }
  return {
    ok: false,
    definitive: false,
    isSign: false,
    totalSignDay: total,
    message: body?.message || "签到失败",
    reward: "",
    rewardIcon: "",
  };
}
