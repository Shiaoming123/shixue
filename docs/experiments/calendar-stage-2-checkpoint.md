# 阶段2检查点

2026-09-09：阶段2完成。下列基础切换记录保留；完整本地闭环证据见末节。阶段3及以后仍待完成。

## 已验证基础

- Workspace当前模型/存储/能力服务读写/导出改为V4；历史V3解析器保持严格version 3，Study1/2和Workspace3导入迁移到4。
- 迁移增加一个确定性的本地源，不把任务复制为Event；冻结V3样本未改。
- CalendarSource/Event/Link/Outcome字段白名单、引用、时间种类、重复例外发生键成员与Outcome原实例键校验已接入。
- V4正常导出保留日历事实；显式task-only V3导出丢弃日历事实及命令凭据，不原地修改当前状态。
- 旧Study writer仅允许空库或版本1/2，拒绝3/4/未知版本；SQLite实际node:sqlite与fake IndexedDB故障测试覆盖保护边界。
- 旧V3云快照在迁移前按原模式验证摘要；篡改拒绝且本地不变。

## 检查

- 导入导出/协议等子模块定向99项通过，check:protocol/typecheck通过。
- 云同步/复习关联/V4模型/冻结样本定向37项通过。
- 日历命令/能力服务/提醒/设置定向139项通过。
- V4切换后smoke:calendar通过（包含vue-tsc/build:web）：6任务、1实例、5视口；Quick Add、详情、完成/重开、专注、筛选、时钟；console/page错误均0。
- 未运行全量npm test/verify，未执行Tauri原生联调；Web烟测不能证明原生通知或数据库驱动。

## 迁移边界与剩余

迁移保存原始快照并回读验证；SQLite候选在独立key写入/回读并严格解析，之后才CAS替换当前记录。替换后确认读取失败会明确报告已写入但确认失败，保留原始备份，不做可能覆盖并发工作的自动回写。IndexedDB候选回读失败在同事务abort。存储模块最终71项定向测试、typecheck和限定diff检查通过。

## 完整本地闭环

- 本地源创建/编辑/显隐/分组/时区/归档和事件CRUD已通过能力服务；事件移动、resize、菜单和键盘走同一信封。外部/只读/归档源拒绝写入，undo复查权限及凭据。
- 事件保持独立事实。三时间kind、全天排他结束、跨日分段、DST、daily/weekly/monthly/yearly及取消/移动/恢复例外可用。系列修改必须真实preview确认；原始实例键稳定。
- V4提醒规范化为target task/event；owner继续表示legacy/user来源。兼容读取旧字段，V3降级投影保留旧规则结构。claim/ack/runtime复用，事件只有打开/稍后/忽略，不能完成任务；移动/取消使旧pending失效；提醒撤销保留投递历史。
- 事件编辑、源管理与提醒均使用既有主题控件；day/week/month/agenda显示并可打开。跨日卡片明确使用详情编辑，不拖动分段；已有例外系列的整体时间/规则迁移显式拒绝，仍可改非时间字段及单次例外。

## 最终验证

- 提醒、模型、迁移、冻结fixture、data-port、云摘要等定向105/105通过；事件/能力服务/placement定向53/53通过；交互模块39/39及菜单revision追加13/13通过（有重叠，不相加声称唯一总数）。
- App原任务提醒等设置行为55项通过；新增事件提醒拒绝任务完成/正确打开原实例/忽略与稍后定向1项通过。
- event-indexeddb单文件2/2：V3原始备份→真实能力命令创建事件/提醒→移动/undo/fresh adapter读回→第二IDB导出导入；只读拒绝与真实adapter CAS保留并发winner。
- 扩展smoke全通过：1440/1280/820/390/320；保留任务drag/resize/keyboard，新增fixed/all-day UI创建、四视图详情、时间编辑/删除/undo、series确认前不写与确认后持久化、提醒添加/undo停用、只读禁写。console/page错误0。
- 浏览器发现并修复series确认VueProxy无法克隆、月格metadata挤压更多按钮。修复后重建并复跑转绿；最终MonthGrid CSS另行reload 820/320复验，无横溢且弹层在viewport内。截图位于artifacts/visual-qa/calendar，最后320弹层已人工查看。
- typecheck/build:web、check:docs/check:protocol、diff检查通过。未运行全量npm test/verify或Tauri原生通知联调；阶段8集中全量验证尚未执行。

上限：事件展开超过10000候选显式失败；重复提醒使用前后90天窗口，已存在投递仍逐条重新验证。阶段3及后续尚未开始。

工作仅在exp/soft-surface-ui指定工作树；未提交、合并或推送，原竞品研究文件保留。
