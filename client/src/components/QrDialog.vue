<script setup>
import QRCode from "qrcode";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api } from "../api.js";

const props = defineProps({ open: Boolean });
const emit = defineEmits(["close", "done"]);

const mode = ref("qr");
const image = ref("");
const message = ref("正在生成二维码");
const status = ref("pending");
const busy = ref(false);

const phone = ref("");
const smsCode = ref("");
const smsSession = ref("");
const smsStep = ref("phone");
const phoneMask = ref("");

let sessionId = "";
let timer = 0;
let polling = false;
const captchaObj = ref(null);

const riskHint = computed(() => (
  status.value === "error" && message.value.includes("风险")
    ? "扫码被风控拦住了，可以改用手机验证码。"
    : ""
));

function resetSms() {
  smsSession.value = "";
  smsStep.value = "phone";
  smsCode.value = "";
  phoneMask.value = "";
  captchaObj.value = null;
}

async function start() {
  window.clearInterval(timer);
  busy.value = true;
  image.value = "";
  status.value = "pending";
  message.value = "正在生成二维码";
  try {
    const created = await api("/api/login/qr", { method: "POST" });
    sessionId = created.sessionId;
    image.value = await QRCode.toDataURL(created.url, {
      margin: 1,
      width: 320,
      color: { dark: "#241a0c", light: "#fffaf0" },
    });
    message.value = "请用米游社扫一扫，并在手机上确认登录";
    timer = window.setInterval(poll, 2000);
  } catch (error) {
    status.value = "error";
    message.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function poll() {
  if (!sessionId || polling || mode.value !== "qr") return;
  polling = true;
  if (status.value === "scanned") message.value = "正在登录，请稍等";
  try {
    const result = await api(`/api/login/qr/${sessionId}`);
    status.value = result.status;
    message.value = result.message || message.value;
    if (result.status === "confirmed") {
      window.clearInterval(timer);
      emit("done");
    }
    if (result.status === "expired" || result.status === "cancelled" || result.status === "error") {
      window.clearInterval(timer);
    }
  } catch (error) {
    status.value = "error";
    message.value = error.message;
    window.clearInterval(timer);
  } finally {
    polling = false;
  }
}

function loadGeetest() {
  if (window.initGeetest) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://static.geetest.com/static/tools/gt.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("安全验证组件没有加载出来"));
    document.head.appendChild(script);
  });
}

function openCaptcha(payload) {
  smsStep.value = "captcha";
  message.value = payload.message || "请先完成安全验证";
  loadGeetest().then(() => {
    window.initGeetest({
      gt: payload.gt,
      challenge: payload.challenge,
      offline: false,
      new_captcha: payload.newCaptcha !== false,
      product: "bind",
    }, (obj) => {
      captchaObj.value = obj;
      obj.onReady(() => obj.verify());
      obj.onSuccess(async () => {
        busy.value = true;
        try {
          const result = await api("/api/login/sms/captcha", {
            method: "POST",
            body: { sessionId: smsSession.value, geetest: obj.getValidate() },
          });
          if (result.status === "captcha") {
            openCaptcha(result);
            return;
          }
          smsStep.value = "code";
          message.value = result.message || "验证码已发送";
        } catch (error) {
          status.value = "error";
          message.value = error.message;
        } finally {
          busy.value = false;
        }
      });
      obj.onError(() => {
        status.value = "error";
        message.value = "安全验证没有通过，请重试";
      });
    });
  }).catch((error) => {
    status.value = "error";
    message.value = error.message;
  });
}

async function sendSms() {
  status.value = "pending";
  message.value = "正在发送验证码";
  busy.value = true;
  try {
    const result = await api("/api/login/sms/send", {
      method: "POST",
      body: { phone: phone.value.trim() },
    });
    smsSession.value = result.sessionId;
    phoneMask.value = result.phoneMask || "";
    if (result.status === "captcha") {
      openCaptcha(result);
      return;
    }
    smsStep.value = "code";
    message.value = result.message || "验证码已发送";
  } catch (error) {
    status.value = "error";
    message.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function verifySms() {
  status.value = "pending";
  message.value = "正在登录";
  busy.value = true;
  try {
    const result = await api("/api/login/sms/verify", {
      method: "POST",
      body: { sessionId: smsSession.value, code: smsCode.value.trim() },
    });
    message.value = result.message || "登录成功";
    emit("done");
  } catch (error) {
    status.value = "error";
    message.value = error.message;
  } finally {
    busy.value = false;
  }
}

function choose(next) {
  mode.value = next;
  status.value = "pending";
  if (next === "qr" && !image.value) start();
  if (next === "sms") window.clearInterval(timer);
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      window.clearInterval(timer);
      return;
    }
    mode.value = "qr";
    resetSms();
    start();
  },
);

onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <h2 id="login-title">登录米游社</h2>
      <div class="tabs" role="tablist">
        <button type="button" :aria-selected="mode === 'qr'" @click="choose('qr')">扫码</button>
        <button type="button" :aria-selected="mode === 'sms'" @click="choose('sms')">手机验证码</button>
      </div>

      <template v-if="mode === 'qr'">
        <p class="muted">打开米游社，进入「我的」，点右上角扫一扫。可以重复添加不同账号。</p>
        <div class="qr-wrap">
          <img v-if="image" :src="image" alt="米游社登录二维码" />
          <p v-else>二维码生成中</p>
        </div>
        <p :class="{ warn: status === 'error' || status === 'expired' }">{{ message }}</p>
        <p v-if="riskHint" class="warn">{{ riskHint }}</p>
        <div class="dialog-actions">
          <button type="button" @click="emit('close')">关闭</button>
          <button type="button" class="primary" :disabled="busy" @click="start">刷新二维码</button>
        </div>
      </template>

      <form v-else class="sms-form" @submit.prevent="smsStep === 'code' ? verifySms() : sendSms()">
        <p class="muted">用绑定米游社的手机号收验证码。验证码只用于这一次登录，不会写进账号记录。</p>
        <label class="field">
          <span>手机号</span>
          <input v-model="phone" inputmode="numeric" maxlength="11" placeholder="11 位手机号" autocomplete="tel" :disabled="smsStep !== 'phone'" />
        </label>
        <label v-if="smsStep === 'code'" class="field">
          <span>验证码 {{ phoneMask }}</span>
          <input v-model="smsCode" inputmode="numeric" maxlength="8" placeholder="短信验证码" autocomplete="one-time-code" />
        </label>
        <p :class="{ warn: status === 'error' }">{{ message }}</p>
        <div class="dialog-actions">
          <button type="button" @click="emit('close')">关闭</button>
          <button v-if="smsStep === 'phone'" type="submit" class="primary" :disabled="busy">获取验证码</button>
          <button v-else-if="smsStep === 'captcha'" type="button" class="primary" :disabled="busy" @click="captchaObj?.verify()">再次验证</button>
          <template v-else>
            <button type="button" :disabled="busy" @click="resetSms(); message = '请重新获取验证码'">换个号码</button>
            <button type="submit" class="primary" :disabled="busy">登录</button>
          </template>
        </div>
      </form>
    </section>
  </div>
</template>
