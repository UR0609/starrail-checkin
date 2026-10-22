<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "./api.js";
import QrDialog from "./components/QrDialog.vue";
import SignCalendar from "./components/SignCalendar.vue";

const accounts = ref([]);
const history = ref([]);
const hour = ref(10);
const minute = ref(0);
const nextRunAt = ref("");
const error = ref("");
const busy = ref(false);
const qrOpen = ref(false);
const authed = ref(false);
const ready = ref(false);
const loginName = ref("");
const loginPassword = ref("");
const showPasswordForm = ref(false);
const currentPassword = ref("");
const nextPassword = ref("");
const nextPasswordAgain = ref("");
const notice = ref("");
const showAllHistory = ref(false);
const pendingDelete = ref("");

const visibleHistory = computed(() => (showAllHistory.value ? history.value : history.value.slice(0, 8)));
const timeLabel = computed(() => `${pad(hour.value)}:${pad(minute.value)}`);
const nextLabel = computed(() => formatWhen(nextRunAt.value) || "读取中");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applyState(state) {
  accounts.value = state.accounts || [];
  history.value = state.history || [];
  hour.value = state.settings?.hour ?? 10;
  minute.value = state.settings?.minute ?? 0;
  nextRunAt.value = state.nextRunAt || "";
}

async function load() {
  applyState(await api("/api/state"));
}

async function run(action) {
  error.value = "";
  busy.value = true;
  try {
    await action();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function saveTime() {
  return run(async () => {
    applyState(await api("/api/settings", {
      method: "PUT",
      body: { hour: Number(hour.value), minute: Number(minute.value) },
    }));
  });
}

function refresh() {
  return run(async () => {
    applyState(await api("/api/refresh", { method: "POST" }));
  });
}

function checkin(accountId) {
  return run(async () => {
    const state = await api("/api/checkin", { method: "POST", body: accountId ? { accountId } : {} });
    applyState(state);
  });
}

function patch(account, body) {
  return run(async () => {
    await api(`/api/accounts/${account.id}`, { method: "PATCH", body });
    await load();
  });
}

function remove(account) {
  if (pendingDelete.value !== account.id) {
    pendingDelete.value = account.id;
    return;
  }
  return run(async () => {
    await api(`/api/accounts/${account.id}`, { method: "DELETE" });
    pendingDelete.value = "";
    await load();
  });
}

function roleClass(role) {
  if (role.isSign) return "ok";
  if (role.message?.includes("验证码") || role.message?.includes("失效")) return "bad";
  return "";
}

function safeIcon(url) {
  return typeof url === "string" && url.startsWith("https://") ? url : "";
}

function onQrDone() {
  qrOpen.value = false;
  load().catch((err) => {
    error.value = err.message;
  });
}

async function enter() {
  error.value = "";
  busy.value = true;
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: { username: loginName.value.trim(), password: loginPassword.value },
    });
    loginPassword.value = "";
    authed.value = true;
    await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function changePassword() {
  error.value = "";
  notice.value = "";
  if (nextPassword.value !== nextPasswordAgain.value) {
    error.value = "两次输入的新密码不一致";
    return;
  }
  busy.value = true;
  try {
    await api("/api/auth/password", {
      method: "POST",
      body: { currentPassword: currentPassword.value, newPassword: nextPassword.value },
    });
    currentPassword.value = "";
    nextPassword.value = "";
    nextPasswordAgain.value = "";
    showPasswordForm.value = false;
    notice.value = "密码已修改";
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  authed.value = false;
  accounts.value = [];
  history.value = [];
}

onMounted(async () => {
  try {
    const session = await api("/api/auth/session");
    authed.value = Boolean(session.ok);
    if (authed.value) await load();
  } catch (err) {
    error.value = err.message;
  } finally {
    ready.value = true;
  }
});
</script>

<template>
  <main v-if="!ready" class="page">
    <p class="muted">正在确认登录状态</p>
  </main>
  <main v-else-if="!authed" class="page">
    <header>
      <div class="brand">
        <div>
          <p class="eyebrow">米游社 · 崩坏：星穹铁道</p>
          <h1>签到助手</h1>
        </div>
      </div>
      <p class="lede">这是本机访问锁。通过之后才能看到米游社账号和签到记录。</p>
    </header>
    <form class="card login-card" @submit.prevent="enter">
      <label class="field">
        <span>用户名</span>
        <input v-model="loginName" autocomplete="username" />
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="loginPassword" type="password" autocomplete="current-password" />
      </label>
      <p v-if="error" class="banner">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy">登录</button>
    </form>
  </main>
  <main v-else class="page">
    <header>
      <div class="header-top">
        <div class="brand">
          <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
            <rect x="4" y="4" width="56" height="56" fill="none" stroke="#e4c07a" stroke-width="2" />
            <path d="M10 40h44M18 24h28" stroke="#e4c07a" stroke-width="2" />
            <circle cx="32" cy="24" r="4" fill="#e4c07a" />
          </svg>
          <div>
            <p class="eyebrow">米游社 · 崩坏：星穹铁道</p>
            <h1>签到助手</h1>
          </div>
        </div>
        <div class="account-actions">
          <button type="button" :disabled="busy" @click="showPasswordForm = !showPasswordForm">修改密码</button>
          <button type="button" :disabled="busy" @click="logout">退出</button>
        </div>
      </div>
      <p class="lede">
        用米游社扫码记下登录。这台电脑会在每天 {{ timeLabel }}（北京时间）给已开启的角色签到。
        一个米游社账号下面如果绑了多个星穹铁道角色，会分别列出，可以单独开关。登录信息只保存在本机。
      </p>
    </header>

    <section class="board">
      <div class="next">
        <span>下次自动签到</span>
        <strong>{{ nextLabel }}</strong>
      </div>
      <form class="time-form" @submit.prevent="saveTime">
        <label class="field">
          <span>时</span>
          <input v-model.number="hour" type="number" min="0" max="23" />
        </label>
        <label class="field">
          <span>分</span>
          <input v-model.number="minute" type="number" min="0" max="59" />
        </label>
        <button type="submit" :disabled="busy">保存时间</button>
      </form>
      <div class="actions">
        <button type="button" :disabled="busy" @click="refresh">刷新状态</button>
        <button type="button" :disabled="busy || !accounts.length" @click="checkin()">全部签到</button>
        <button type="button" class="primary" :disabled="busy" @click="qrOpen = true">添加角色</button>
      </div>
    </section>

    <form v-if="showPasswordForm" class="card password-card" @submit.prevent="changePassword">
      <label class="field">
        <span>当前密码</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" />
      </label>
      <label class="field">
        <span>新密码</span>
        <input v-model="nextPassword" type="password" autocomplete="new-password" />
      </label>
      <label class="field">
        <span>再输入一次</span>
        <input v-model="nextPasswordAgain" type="password" autocomplete="new-password" />
      </label>
      <button type="submit" class="primary" :disabled="busy">保存新密码</button>
    </form>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <p v-if="error" class="banner">{{ error }}</p>

    <section v-if="!accounts.length" class="empty">
      <h2>还没有角色</h2>
      <p class="muted">点「添加角色」，用手机米游社扫页面上的二维码。每个账号扫一次，之后不用再扫。</p>
    </section>

    <section v-else class="cards">
      <article v-for="account in accounts" :key="account.id" class="card">
        <div class="card-head">
          <div>
            <label class="name">
              <span class="muted">备注</span>
              <input
                :value="account.nickname"
                maxlength="20"
                @change="patch(account, { nickname: $event.target.value })"
              />
            </label>
            <p class="account-id">米游社 {{ account.stuid }}</p>
            <p v-if="!account.authOk" class="warn">{{ account.authMessage || "登录已失效，请重新扫码" }}</p>
          </div>
          <div class="card-actions">
            <label class="switch">
              <input
                type="checkbox"
                :checked="account.enabled"
                @change="patch(account, { enabled: $event.target.checked })"
              />
              每天自动签到
            </label>
            <button type="button" :disabled="busy" @click="checkin(account.id)">立即签到</button>
            <button type="button" :disabled="busy" @click="remove(account)">
              {{ pendingDelete === account.id ? "再点一次确认删除" : "删除" }}
            </button>
          </div>
        </div>

        <div v-if="!account.roles.length" class="muted">这个账号还没有绑定星穹铁道角色。</div>
        <div v-else class="roles">
          <div v-for="role in account.roles" :key="role.gameUid" class="role">
            <div class="role-main">
              <div class="role-top">
                <h3>{{ role.nickname }}</h3>
                <span class="pill" :class="roleClass(role)">{{ role.isSign ? "今日已签" : "未签到" }}</span>
              </div>
              <p class="role-meta">UID {{ role.gameUid }} · {{ role.regionName }} · {{ role.level }} 级 · 本月 {{ role.totalSignDay }} 天</p>
              <p v-if="role.reward" class="reward">
                <img v-if="safeIcon(role.rewardIcon)" :src="safeIcon(role.rewardIcon)" alt="" />
                <span>{{ role.isSign ? "今日奖励" : "下次奖励" }} {{ role.reward }}</span>
              </p>
              <p v-if="role.message" class="muted">{{ role.message }}</p>
              <SignCalendar :dates="role.signedDates" :total-sign-day="role.totalSignDay" />
            </div>
            <label class="switch">
              <input
                type="checkbox"
                :checked="role.enabled"
                @change="patch(account, { roles: { [role.gameUid]: $event.target.checked } })"
              />
              参与签到
            </label>
          </div>
        </div>
      </article>
    </section>

    <section class="history">
      <h2>签到记录</h2>
      <p v-if="!history.length" class="muted">还没有记录。自动签到和手动签到都会写在这里。</p>
      <div v-for="item in visibleHistory" :key="item.id" class="history-row">
        <div>
          <strong>{{ item.nickname || "账号" }}</strong>
          <span class="muted"> {{ item.gameUid }}</span>
          <p :class="item.ok ? 'ok-text' : 'bad-text'">{{ item.message }}<template v-if="item.reward"> · {{ item.reward }}</template></p>
        </div>
        <time>{{ formatWhen(item.at) }}</time>
      </div>
      <button v-if="history.length > 8" type="button" @click="showAllHistory = !showAllHistory">
        {{ showAllHistory ? "收起" : "展开全部" }}
      </button>
    </section>

    <QrDialog :open="qrOpen" @close="qrOpen = false" @done="onQrDone" />
  </main>
</template>
