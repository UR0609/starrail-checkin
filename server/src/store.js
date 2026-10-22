import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY = {
  settings: { hour: 10, minute: 0, lastAutoDate: "" },
  accounts: [],
  history: [],
};

export function createStore(dir) {
  const file = path.join(dir, "accounts.json");

  async function ensure() {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await readFile(file, "utf8");
    } catch {
      await write(EMPTY);
    }
  }

  async function read() {
    await ensure();
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw);
    data.settings = { ...EMPTY.settings, ...data.settings };
    data.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    data.history = Array.isArray(data.history) ? data.history : [];
    return data;
  }

  async function write(data) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }

  return {
    file,
    read,
    async update(mutator) {
      const data = await read();
      const next = (await mutator(data)) || data;
      await write(next);
      return next;
    },
  };
}

export function toPublic(account) {
  return {
    id: account.id,
    nickname: account.nickname,
    stuid: account.stuid,
    enabled: account.enabled !== false,
    createdAt: account.createdAt,
    authOk: account.authOk !== false,
    authMessage: account.authMessage || "",
    roles: (account.roles || []).map((role) => ({
      gameUid: role.gameUid,
      nickname: role.nickname,
      region: role.region,
      regionName: role.regionName,
      level: role.level,
      enabled: role.enabled !== false,
      isSign: Boolean(role.isSign),
      totalSignDay: role.totalSignDay || 0,
      reward: role.reward || "",
      rewardIcon: role.rewardIcon || "",
      message: role.message || "",
      checkedAt: role.checkedAt || "",
      signedDates: Array.isArray(role.signedDates) ? role.signedDates : [],
    })),
  };
}
