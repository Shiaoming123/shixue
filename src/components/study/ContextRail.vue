<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'

export interface RailReviewItem {
  id: string
  topic: string
  summary: string
  reviewedOn: string
}

defineProps<{
  dayIndex: number
  completedDays: number
  reviews: RailReviewItem[]
}>()

const emit = defineEmits<{ openReview: [] }>()
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
</script>

<template>
  <aside class="context-rail">
    <section>
      <h2>本周节奏</h2>
      <div class="week-strip">
        <span v-for="(day, index) in weekdays" :key="day" :class="{ current: index === dayIndex }">
          <small>{{ day }}</small>
          <i :class="{ complete: index < completedDays }">{{ index < completedDays ? '✓' : '' }}</i>
        </span>
      </div>
    </section>

    <section class="reviews">
      <h2>待复习</h2>
      <button v-for="item in reviews.slice(0, 2)" :key="item.id" @click="emit('openReview')">
        <strong>{{ item.topic }}</strong>
        <span>{{ item.summary }}</span>
        <small>上次复习：{{ item.reviewedOn }}</small>
        <ChevronRight :size="18" />
      </button>
      <p v-if="reviews.length === 0" class="empty">今天没有到期记录，可以专心推进当前一步。</p>
    </section>
  </aside>
</template>

<style scoped>
.context-rail {
  width: 292px;
  min-width: 292px;
  padding: 50px 28px;
  border-left: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 68%, transparent);
}

h2 {
  margin: 0;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border);
  font-size: 17px;
  font-weight: 650;
}

.week-strip {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 5px;
  padding: 21px 0 31px;
  border-bottom: 1px solid var(--border);
}

.week-strip span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  padding: 7px 0;
  border-radius: 10px;
}

.week-strip span.current {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}

.week-strip small {
  font-size: 10px;
}

.week-strip i {
  width: 19px;
  height: 19px;
  display: grid;
  place-items: center;
  border: 1.5px solid color-mix(in srgb, var(--muted) 42%, transparent);
  border-radius: 50%;
  font-size: 10px;
  font-style: normal;
}

.week-strip i.complete {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-text);
}

.reviews {
  margin-top: 30px;
}

.reviews button {
  position: relative;
  width: 100%;
  min-height: 112px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 17px 26px 15px 1px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.reviews strong {
  font-size: 13px;
  font-weight: 650;
}

.reviews span {
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reviews small {
  color: var(--muted);
  font-size: 10px;
}

.reviews svg {
  position: absolute;
  right: 0;
  top: 46px;
  color: var(--muted);
}

.empty {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}

@media (max-width: 1100px) {
  .context-rail {
    display: none;
  }
}
</style>
