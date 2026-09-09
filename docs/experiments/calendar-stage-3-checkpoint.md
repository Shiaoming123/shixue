# 阶段3检查点

2026-09-09，`exp/soft-surface-ui` 工作树，未提交、合并或推送。

## 交付

- 空白时间轴点击/拖选按15分钟吸附，明确选择任务或日程；取消不写入。Quick Add接收定时起点和时长，用户明确输入的时间优先。触摸滚动不误创建。
- 任务卡片完成/重开复用Task命令；学习任务继续要求完成证据。窄卡通过安排菜单操作，事件没有任务完成按钮。
- 已结束日程可显式创建跟进任务、纪要或无需跟进记录。按事件、原始实例时间和动作去重；跟进任务必须选择清单，不自动制造待办。
- link/unlink独立于Task/Event事实；取消关联不删除任务、日程或已有会后记录。撤销新建跟进任务时检查任务版本，保留用户后续编辑。
- 移动端日历整体可滚动，时间轴保留最小高度；真实滚动视口止于固定底部导航上方。窄重叠卡正文与菜单保留独立点击区域。

## 验证

- `node --experimental-strip-types --test tests/event-outcomes.test.ts tests/calendar-slot.test.ts tests/quick-add-parser.test.ts tests/quick-add-composer-state.test.ts`：30/30，包括导出/导入后事实一致、去重、删除不传播、真实实例和结束时间检查。
- `build:web`通过；扩展日历smoke使用同一构建产物最终完整通过，5个视口，consoleErrors/pageErrors均0。包括原有任务/日程操作、新建预填实际持久化时间、学习证据、会后三动作和取消关联、320px触摸。
- 额外320×700压力布局：4个重叠任务、2条全天行，时间轴可视高度至少120px，滚动视口底边不越底部导航；正文、详情和新建编辑器可达。截图位于`artifacts/visual-qa/calendar/calendar-mobile-timeline-320x700.png`与`calendar-mobile-slot-320x700.png`。
- 阶段内未运行全量`npm test`/`verify`。原生外部账号联调不属于本阶段完成证据。

## 后续

阶段4只读连接器仍在实现：默认关闭runtime、provider fake、原生OAuth与增量批次已进入接口验收，不能称真实账号同步完成。阶段5纯建议器可并行推进；阶段7仍等待真实多时间盒使用需求。
