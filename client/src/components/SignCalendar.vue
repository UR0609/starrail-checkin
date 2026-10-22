<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  dates: { type: Array, default: () => [] },
  totalSignDay: { type: Number, default: 0 },
});

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const today = shanghaiToday();
const currentYear = Number(today.slice(0, 4));
const currentMonth = Number(today.slice(5, 7));
const cursor = ref({ year: currentYear, month: currentMonth });
const picking = ref(false);
const draftYear = ref(currentYear);
const years = computed(() => {
  const list = [];
  for (let year = 2023; year <= currentYear; year += 1) list.push(year);
  return list;
});
const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const signed = computed(() => new Set(props.dates || []));
const atCurrentMonth = computed(() => cursor.value.year === currentYear && cursor.value.month === currentMonth);

function isFuture(year, month) {
  return year > currentYear || (year === currentYear && month > currentMonth);
}

const cells = computed(() => {
  const { year, month } = cursor.value;
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lead = (firstWeekday + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let index = 0; index < lead; index += 1) days.push(null);
  for (let day = 1; day <= count; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    days.push({
      day,
      date,
      signed: signed.value.has(date),
      today: date === today,
      future: date > today,
    });
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
});

const markedCount = computed(() => cells.value.filter((cell) => cell?.signed).length);
const gap = computed(() => atCurrentMonth.value && props.totalSignDay > markedCount.value);

function shift(step) {
  const next = new Date(Date.UTC(cursor.value.year, cursor.value.month - 1 + step, 1));
  const year = next.getUTCFullYear();
  const month = next.getUTCMonth() + 1;
  if (isFuture(year, month)) return;
  cursor.value = { year, month };
  picking.value = false;
}

function togglePicker() {
  draftYear.value = cursor.value.year;
  picking.value = !picking.value;
}

function chooseMonth(month) {
  if (isFuture(draftYear.value, month)) return;
  cursor.value = { year: draftYear.value, month };
  picking.value = false;
}
</script>

<template>
  <section class="calendar" aria-label="签到日历">
    <div class="calendar-head">
      <button type="button" @click="shift(-1)">上个月</button>
      <button type="button" class="month-label" :aria-expanded="picking" @click="togglePicker">
        {{ cursor.year }}年{{ cursor.month }}月
      </button>
      <button type="button" :disabled="atCurrentMonth" @click="shift(1)">下个月</button>
    </div>
    <div v-if="picking" class="month-picker">
      <div class="year-row">
        <button
          v-for="year in years"
          :key="year"
          type="button"
          :aria-selected="year === draftYear"
          @click="draftYear = year"
        >{{ year }}</button>
      </div>
      <div class="month-row">
        <button
          v-for="month in months"
          :key="month"
          type="button"
          :disabled="isFuture(draftYear, month)"
          :aria-selected="draftYear === cursor.year && month === cursor.month"
          @click="chooseMonth(month)"
        >{{ month }}月</button>
      </div>
    </div>
    <div class="calendar-week">
      <span v-for="name in weekdays" :key="name">{{ name }}</span>
    </div>
    <div class="calendar-grid">
      <span v-for="(cell, index) in cells" :key="index" class="day" :class="{ signed: cell?.signed, today: cell?.today, future: cell?.future, empty: !cell }">
        <template v-if="cell">{{ cell.day }}</template>
      </span>
    </div>
    <p class="muted">这个月标出 {{ markedCount }} 天</p>
    <p v-if="gap" class="muted">米哈游记录本月已签 {{ totalSignDay }} 天。漏签过的日期，只会标出这里实际看到的日子。</p>
  </section>
</template>
