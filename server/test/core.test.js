import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gameTokenBody, md5, passportDs, webDs } from "../src/ds.js";
import { aigisHeader, parseAigis } from "../src/mihoyo.js";
import { rsaEncrypt } from "../src/rsa.js";
import { interpretInfo, interpretSignResult, mergeSignedDates, previewFromInfo } from "../src/sign.js";
import { createStore, toPublic } from "../src/store.js";
import { isPastSlot, nextRunAt, shanghaiDate, shouldCatchUp } from "../src/time.js";

const tenShanghai = new Date(Date.UTC(2026, 9, 22, 2, 0, 0));

test("game token body matches the signed JSON spacing", () => {
  assert.equal(gameTokenBody(100, "tok"), '{"account_id": 100, "game_token": "tok"}');
  assert.equal(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  const ds = webDs(Date.UTC(2026, 9, 22, 2, 0, 0));
  assert.equal(ds.split(",").length, 3);
});

test("phone login helpers keep the passport shape", () => {
  assert.equal(passportDs(Date.UTC(2026, 9, 22, 2, 0, 0)).split(",").length, 3);
  assert.equal(Buffer.from(rsaEncrypt("+86"), "base64").length, 128);
  const header = JSON.stringify({
    session_id: "abc",
    data: JSON.stringify({ gt: "gt-1", challenge: "ch-1", new_captcha: 1 }),
  });
  assert.equal(parseAigis(header).gt, "gt-1");
  const packed = aigisHeader("abc", {
    geetest_challenge: "c",
    geetest_validate: "v",
    geetest_seccode: "s|jordan",
  });
  assert.equal(packed.startsWith("abc;"), true);
  assert.equal(Buffer.from(packed.slice(4), "base64").toString().includes("geetest_validate"), true);
});

test("sign responses become a readable result", () => {
  const awards = [
    { name: "星琼", cnt: 60, icon: "https://example.com/a.png" },
    { name: "信用点", cnt: 5000, icon: "https://example.com/b.png" },
  ];
  const info = { total_sign_day: 1, is_sign: false };
  assert.deepEqual(previewFromInfo(info, awards).reward, "信用点 ×5000");
  assert.equal(interpretSignResult(info, { retcode: 0, data: { success: 0 } }, awards).message, "签到成功");
  assert.equal(interpretSignResult(info, { retcode: 0, data: { success: 0 } }, awards).reward, "信用点 ×5000");
  assert.equal(interpretSignResult(info, { retcode: -5003 }, awards).message, "今天已经签过了");
  assert.equal(interpretSignResult(info, { retcode: 0, data: { success: 1, gt: "secret" } }, awards).captcha, true);
  assert.equal("gt" in interpretSignResult(info, { retcode: 0, data: { success: 1, gt: "secret" } }, awards), false);
  assert.equal(interpretInfo({ retcode: 0, data: { first_bind: true, total_sign_day: 0 } }).message.includes("手动签到"), true);
  assert.equal(interpretInfo({ retcode: -100 }).authDead, true);
});

test("a month with no misses fills every signed day", () => {
  assert.deepEqual(mergeSignedDates(["2026-09-30"], {
    today: "2026-10-03",
    is_sign: true,
    total_sign_day: 3,
    sign_cnt_missed: 0,
  }), ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(mergeSignedDates([], {
    today: "2026-10-22",
    is_sign: true,
    total_sign_day: 12,
    sign_cnt_missed: 10,
  }), ["2026-10-22"]);
  assert.deepEqual(mergeSignedDates(["2026-10-02"], {
    today: "2026-10-04",
    is_sign: false,
    total_sign_day: 2,
  }), ["2026-10-02"]);
});

test("10:00 Shanghai is the daily slot", () => {
  assert.equal(shanghaiDate(tenShanghai), "2026-10-22");
  assert.equal(isPastSlot(10, 0, tenShanghai), true);
  assert.equal(isPastSlot(10, 0, new Date(tenShanghai.getTime() - 60 * 1000)), false);
  assert.equal(shouldCatchUp({ now: tenShanghai, hour: 10, minute: 0, lastAutoDate: "" }), true);
  assert.equal(shouldCatchUp({ now: tenShanghai, hour: 10, minute: 0, lastAutoDate: "2026-10-22" }), false);
  const next = nextRunAt(10, 0, new Date(tenShanghai.getTime() - 60 * 1000));
  assert.equal(next, tenShanghai.toISOString());
  const tomorrow = nextRunAt(10, 0, tenShanghai);
  assert.equal(tomorrow > tenShanghai.toISOString(), true);
});

test("stored secrets stay out of the page payload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "starrail-"));
  const store = createStore(dir);
  await store.update((data) => {
    data.accounts.push({
      id: "11111111-1111-1111-1111-111111111111",
      nickname: "开拓者",
      stuid: "88",
      stoken: "secret-stoken",
      ltoken: "secret-ltoken",
      cookieToken: "secret-cookie",
      mid: "secret-mid",
      deviceId: "device",
      deviceFp: "fp",
      enabled: true,
      roles: [{ gameUid: "100", nickname: "开拓者", region: "prod_gf_cn", regionName: "星穹列车", level: 70, enabled: true }],
    });
    return data;
  });
  const saved = await store.read();
  const pub = toPublic(saved.accounts[0]);
  assert.equal(pub.nickname, "开拓者");
  assert.equal(JSON.stringify(pub).includes("secret"), false);
  const raw = await readFile(store.file, "utf8");
  assert.equal(raw.includes("secret-stoken"), true);
});
