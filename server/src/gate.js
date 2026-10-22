import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const COOKIE = "checkin_session";
const WEEK = 7 * 24 * 60 * 60;

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 32);
}

export async function createGateFile(file, { username, password, sessionSecret }) {
  const salt = randomBytes(16);
  const record = {
    username,
    salt: b64url(salt),
    hash: b64url(hashPassword(password, salt)),
    sessionSecret: sessionSecret || b64url(randomBytes(32)),
  };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

export function openGate(record) {
  const salt = Buffer.from(record.salt, "base64url");
  const hash = Buffer.from(record.hash, "base64url");
  const secret = record.sessionSecret;

  function login(username, password) {
    const nameOk = typeof username === "string"
      && username.length === record.username.length
      && timingSafeEqual(Buffer.from(username), Buffer.from(record.username));
    const digest = hashPassword(password ?? "", salt);
    const passwordOk = digest.length === hash.length && timingSafeEqual(digest, hash);
    return nameOk && passwordOk;
  }

  function seal(username) {
    const body = Buffer.from(JSON.stringify({
      u: username,
      exp: Date.now() + WEEK * 1000,
    })).toString("base64url");
    const mac = createHmac("sha256", secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }

  function open(token) {
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [body, mac] = token.split(".");
    const expected = createHmac("sha256", secret).update(body).digest("base64url");
    const left = Buffer.from(mac);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      if (!payload?.u || payload.exp < Date.now()) return null;
      return payload.u;
    } catch {
      return null;
    }
  }

  function readRequest(req) {
    const header = req.headers?.cookie || "";
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index === -1) continue;
      const name = part.slice(0, index).trim();
      if (name !== COOKIE) continue;
      return open(decodeURIComponent(part.slice(index + 1).trim()));
    }
    return null;
  }

  return {
    username: record.username,
    login,
    cookie(username) {
      return `${COOKIE}=${seal(username)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK}`;
    },
    clearCookie() {
      return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
    },
    readRequest,
  };
}

export async function loadGate(file) {
  const raw = await readFile(file, "utf8");
  return openGate(JSON.parse(raw));
}

export async function changeGatePassword(file, currentPassword, newPassword) {
  const record = JSON.parse(await readFile(file, "utf8"));
  const gate = openGate(record);
  if (!gate.login(record.username, currentPassword)) return null;
  const salt = randomBytes(16);
  const next = {
    username: record.username,
    salt: b64url(salt),
    hash: b64url(hashPassword(newPassword, salt)),
    sessionSecret: b64url(randomBytes(32)),
  };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return openGate(next);
}
