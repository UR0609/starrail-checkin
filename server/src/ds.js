import { createHash, randomInt } from "node:crypto";

export const WEB_SALT = "d9200c846b10886e8c874fc33c8f308b";
export const SALT_X4 = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs";
export const SALT_K2 = "OvOIsZRXrUbXoUlpQuhEx4tgAwNVUMmp";
export const PASSPORT_SALT = "QVu5OdwEWxkq9ygpYBgDprR5tI471HWQ";

export function md5(text) {
  return createHash("md5").update(text).digest("hex");
}

function sample(alphabet, length) {
  const pool = alphabet.split("");
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const index = randomInt(pool.length);
    out += pool.splice(index, 1)[0];
  }
  return out;
}

/** Web DS used by the luna check-in endpoints. The body is not part of the hash. */
export function webDs(now = Date.now()) {
  const t = String(Math.floor(now / 1000));
  const r = sample("abcdefghijklmnopqrstuvwxyz0123456789", 6);
  return `${t},${r},${md5(`salt=${WEB_SALT}&t=${t}&r=${r}`)}`;
}

/** DS for exchanging a game token. `body` must be the exact JSON string that is posted. */
export function k2Ds(body, now = Date.now()) {
  const t = String(Math.floor(now / 1000));
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let r = "";
  for (let i = 0; i < 6; i += 1) r += letters[randomInt(letters.length)];
  return `${t},${r},${md5(`salt=${SALT_K2}&t=${t}&r=${r}&b=${body}&q=`)}`;
}

/** Passport DS for the 2.81.1 app login calls. The body is not part of the hash. */
export function passportDs(now = Date.now()) {
  const t = String(Math.floor(now / 1000));
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let r = "";
  for (let i = 0; i < 6; i += 1) r += alphabet[randomInt(alphabet.length)];
  return `${t},${r},${md5(`salt=${PASSPORT_SALT}&t=${t}&r=${r}`)}`;
}

export function x4Ds(query = "", body = "", now = Date.now()) {
  const t = String(Math.floor(now / 1000));
  const r = String(randomInt(100000, 200001));
  return `${t},${r},${md5(`salt=${SALT_X4}&t=${t}&r=${r}&b=${body}&q=${query}`)}`;
}

/**
 * Match Python json.dumps spacing. The K2 signature is computed over this exact string,
 * and the same string has to be the POST body.
 */
export function gameTokenBody(accountId, gameToken) {
  return `{"account_id": ${Number(accountId)}, "game_token": ${JSON.stringify(String(gameToken))}}`;
}
