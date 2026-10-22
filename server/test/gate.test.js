import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { changeGatePassword, createGateFile, loadGate } from "../src/gate.js";

test("page login accepts only the saved password", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gate-"));
  const file = path.join(dir, "auth.json");
  await createGateFile(file, { username: "admin", password: "correct-horse" });
  const gate = await loadGate(file);
  assert.equal(gate.login("admin", "correct-horse"), true);
  assert.equal(gate.login("admin", "wrong"), false);
  assert.equal(gate.login("other", "correct-horse"), false);
  const header = gate.cookie("admin");
  const token = header.split(";")[0].split("=")[1];
  assert.equal(gate.readRequest({ headers: { cookie: `checkin_session=${token}` } }), "admin");
  assert.equal(gate.readRequest({ headers: { cookie: "checkin_session=tampered.token" } }), null);
  assert.equal(await changeGatePassword(file, "wrong", "another-password"), null);
  const changed = await changeGatePassword(file, "correct-horse", "another-password");
  assert.equal(changed.login("admin", "another-password"), true);
  assert.equal(changed.login("admin", "correct-horse"), false);
  assert.equal(changed.readRequest({ headers: { cookie: `checkin_session=${token}` } }), null);
});
