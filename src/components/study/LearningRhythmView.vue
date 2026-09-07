<script setup lang="ts">
import Button from '../ui/Button.vue'

export type LearningRhythmNextState = 'overdue' | 'today' | 'upcoming' | 'none'

export interface LearningRhythmViewItem {
  seriesId: string
  taskId: string
  listId: string
  title: string
  topic: string
  cadenceLabel: string
  weekLabel: string
  plannedCount: number
  completedWithEvidenceCount: number
  completedMissingEvidenceCount: number
  skippedCount: number
  cancelledCount: number
  streakCount: number
  nextOccurrenceId: string | null
  nextLabel: string
  nextState: LearningRhythmNextState
  recentLearned: string
}

export interface LearningRhythmTotals {
  planned: number
  completedWithEvidence: number
  completedMissingEvidence: number
  skipped: number
  cancelled: number
}

defineProps<{
  items: readonly LearningRhythmViewItem[]
  totals: LearningRhythmTotals
}>()

const emit = defineEmits<{
  openOccurrence: [occurrenceId: string]
  openTask: [taskId: string]
  editTask: [taskId: string]
}>()

const nextStateLabels: Readonly<Record<LearningRhythmNextState, string>> = {
  overdue: '等待继续',
  today: '今天',
  upcoming: '接下来',
  none: '暂无下一次',
}

function progressPercent(item: LearningRhythmViewItem): number {
  if (item.plannedCount <= 0) return 0
  return Math.min(100, Math.round(item.completedWithEvidenceCount / item.plannedCount * 100))
}

function secondaryCounts(item: LearningRhythmViewItem): string {
  return [
    item.skippedCount ? `跳过 ${item.skippedCount} 次` : '',
    item.cancelledCount ? `取消 ${item.cancelledCount} 次` : '',
    item.streakCount ? `连续完成 ${item.streakCount} 次` : '',
  ].filter(Boolean).join(' · ')
}
</script>

<template>
  <section class="rhythm-view" aria-labelledby="learning-rhythm-title">
    <header class="rhythm-header">
      <div>
        <p>按各节律时区统计</p>
        <h1 id="learning-rhythm-title">本周节律</h1>
      </div>
      <p v-if="items.length" class="total-progress">
        有证据完成 <strong>{{ totals.completedWithEvidence }}</strong> / 计划 <strong>{{ totals.planned }}</strong> 次
      </p>
    </header>

    <div v-if="items.length" class="rhythm-list">
      <article v-for="item in items" :key="item.seriesId" class="rhythm-row">
        <div class="row-heading">
          <div class="row-title">
            <small>{{ item.topic }} · {{ item.cadenceLabel }} · {{ item.weekLabel }}</small>
            <h2>{{ item.title }}</h2>
          </div>
          <span class="next-state" :class="`next-state--${item.nextState}`">
            <strong>{{ nextStateLabels[item.nextState] }}</strong>
            <small v-if="item.nextLabel">{{ item.nextLabel }}</small>
          </span>
        </div>

        <div class="progress-copy">
          <span>本周 {{ item.completedWithEvidenceCount }} / {{ item.plannedCount }} 次</span>
          <small v-if="secondaryCounts(item)">{{ secondaryCounts(item) }}</small>
        </div>
        <div
          class="progress-track"
          role="progressbar"
          :aria-label="`${item.title} 本周有证据完成进度`"
          aria-valuemin="0"
          :aria-valuemax="Math.max(1, item.plannedCount)"
          :aria-valuenow="item.completedWithEvidenceCount"
        >
          <i :style="{ width: `${progressPercent(item)}%` }" />
        </div>

        <p v-if="item.recentLearned" class="recent-learned"><span>最近收获</span>{{ item.recentLearned }}</p>
        <p v-if="item.completedMissingEvidenceCount" class="evidence-warning" role="status">
          {{ item.completedMissingEvidenceCount }} 次完成缺少学习证据，未计入进度。
        </p>

        <footer class="row-actions">
          <Button
            v-if="item.nextOccurrenceId"
            variant="primary"
            @click="emit('openOccurrence', item.nextOccurrenceId)"
          >继续本次</Button>
          <Button variant="secondary" @click="emit('openTask', item.taskId)">查看任务</Button>
          <Button variant="secondary" @click="emit('editTask', item.taskId)">编辑节律</Button>
        </footer>
      </article>
    </div>

    <article v-else class="empty-state">
      <h2>还没有学习节律</h2>
      <p>为学习任务设置重复后，每次留下的证据会汇总到这里。</p>
    </article>
  </section>
</template>

<style scoped>
.rhythm-view {
  width: min(100%, 820px);
  margin: 0 auto;
  padding: 44px 48px 100px;
  color: var(--text);
}

.rhythm-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-5);
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--border);
}

.rhythm-header p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
.rhythm-header > div > p { margin-bottom: var(--space-2); color: var(--accent); font-weight: var(--font-medium); }
.rhythm-header h1 { margin: 0; font-size: var(--text-xl); line-height: 1.25; font-weight: 650; letter-spacing: -.02em; }
.total-progress { text-align: right; }
.total-progress strong { color: var(--accent); font-variant-numeric: tabular-nums; }

.rhythm-list { border-bottom: 1px solid var(--border); }
.rhythm-row { padding: var(--space-5) 0; border-bottom: 1px solid var(--border); }
.rhythm-row:last-child { border-bottom: 0; }
.row-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.row-title { min-width: 0; }
.row-title small { color: var(--accent); font-size: var(--text-xs); }
.row-title h2 { margin: var(--space-1) 0 0; font-size: var(--text-md); line-height: 1.35; font-weight: 620; }

.next-state { flex: 0 0 auto; display: flex; align-items: flex-end; flex-direction: column; gap: 2px; color: var(--muted); text-align: right; }
.next-state strong { font-size: var(--text-xs); font-weight: 650; }
.next-state small { font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.next-state--overdue, .next-state--today { color: var(--warning); }
.next-state--upcoming { color: var(--accent); }

.progress-copy { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-4); color: var(--muted); font-size: var(--text-xs); }
.progress-copy span { color: var(--text); font-variant-numeric: tabular-nums; }
.progress-track { height: 5px; overflow: hidden; margin-top: var(--space-2); border-radius: var(--radius-full); background: var(--control-fill); }
.progress-track i { display: block; height: 100%; border-radius: inherit; background: var(--accent); }

.recent-learned { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: var(--space-3); margin: var(--space-4) 0 0; color: var(--text); font-size: var(--text-sm); line-height: 1.55; }
.recent-learned span { color: var(--muted); font-size: var(--text-xs); }
.evidence-warning { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border-left: 2px solid var(--warning); background: color-mix(in srgb, var(--warning) 7%, transparent); color: var(--warning); font-size: var(--text-xs); line-height: 1.5; }

.row-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-4); }
.row-actions :deep(.btn) { min-height: 44px; }

.empty-state { min-height: 330px; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: var(--space-8) var(--space-5); text-align: center; }
.empty-state h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
.empty-state p { max-width: 360px; margin: 0; color: var(--muted); font-size: var(--text-sm); line-height: 1.55; }

@media (max-width: 819px) {
  .rhythm-view { padding: 27px 20px 126px; }
  .rhythm-header { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
  .total-progress { text-align: left; }
}

@media (max-width: 439px) {
  .row-heading { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
  .next-state { align-items: flex-start; flex-direction: row; gap: var(--space-2); text-align: left; }
  .progress-copy { align-items: flex-start; flex-direction: column; gap: var(--space-1); }
  .recent-learned { grid-template-columns: 1fr; gap: var(--space-1); }
  .row-actions { align-items: stretch; flex-direction: column; }
  .row-actions :deep(.btn) { width: 100%; }
}
</style>
