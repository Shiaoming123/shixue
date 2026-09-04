# 个人学习记录助手：市场研究与 MVP 取舍

> 调研日期：2026-09-04
> 范围：只核对产品官方页面、官方帮助中心与官方文档；本文中的 MVP 结论是基于这些产品机制做出的产品判断，不代表各厂商公开路线图。

## 一句话结论

首版不应做成“另一个万能笔记”或“AI 家教”，而应做成一个完整、低摩擦的学习闭环：**快速记录 → 进入专注 → 结束时反思 → 到期再回顾 → 每周看见进展**。

这个取舍来自几类已经被不同产品反复验证的核心行为：Notion 把任务、笔记和资料组织在一起；Readwise 把采集、标注与再次浮现连接起来；Forest 和 Focus To-Do 把开始行动、专注计时与历史统计连接起来；RemNote 和 Anki 把主动回忆与到期复习连接起来；MyStudyLife 则把今天要做什么、提醒和学习计划放在一个学生视角的首页中。对应的一手证据见下表。

## 市场机制扫描

| 产品 | 官方资料确认的核心机制 | 用户真正雇佣它完成的任务 | 对本项目的启发 |
| --- | --- | --- | --- |
| Notion | 官方教育指南把它定位为可同时管理课程、项目、笔记与资料的可定制工作区；学校模板覆盖课堂笔记、阅读列表、论文计划等场景。([Notion for school](https://www.notion.com/help/guides/setting-up-notion-for-school)) 官方学期指南还给出“记录并打标签、排序/过滤、集中资料与引用”的流程。([Semester guide](https://www.notion.com/help/guides/get-organized-for-a-new-semester-with-notion)) | 把分散的学习对象、任务、笔记和来源归到一个可查询的结构里。 | 用少量固定字段提供结构，同时避免让用户先搭数据库、选模板、配视图。 |
| Readwise Reader / Reviews | Reader 可从浏览器扩展或移动端分享菜单保存内容，并在保存时添加标签、文档备注和收件箱位置。([Saving content](https://docs.readwise.io/reader/docs/saving-content)) Readwise 的 Daily Review 会再次呈现合适的高亮；Reader 支持跨内容全文搜索，并把产品明确描述为可离线使用的 local-first 应用。([Reader](https://readwise.io/read/), [Search](https://docs.readwise.io/reader/docs/faqs/searching)) 官方 CLI 还支持将整个资料库导出为 Markdown。([CLI export](https://docs.readwise.io/tools/cli)) | 不只“收藏”，而是把输入变成可找回、可再次遇见的个人知识。 | 每条记录必须能保存来源与一句收获；首页必须有“今天回顾”，并提供本地搜索和可携带导出。首版无需自建网页阅读器。 |
| Forest | 官方流程是选择时长和树种开始专注，专注时间让树成长，完成后树进入个人森林；它还提供应用阻断、按日/周/月查看的专注分析、标签和组队专注。核心计时、树与统计可离线运行。([Forest](https://www.forestapp.cc/)) | 克服“开始不了”和中途分心，并把抽象时间变成可见的积累。 | 计时必须一键开始；完成反馈应有可积累的视觉结果。中断应被诚实记录，但文案不羞辱用户。首版不做系统级应用阻断和社交房间。 |
| Focus To-Do | 官方页面把 Pomodoro、任务、截止日、提醒、子任务、重复、备注、跨设备同步和历史报告放在同一条链路中；报告按日/周/月分析时间、任务完成和项目时间占比。([Focus To-Do](https://www.focustodo.cn/?lang=en_US)) | 把“我要学”变成可执行任务，再用计时和报告回答“时间花到哪里了”。 | 专注会话应归属某个学习主题/记录；周报只展示能促进行动的少量指标，不堆复杂图表。 |
| RemNote | 用户可以从笔记、阅读标注、导入或 AI 生成卡片；全局复习队列只呈现当前到期内容，并根据难度反馈继续安排。([Getting started with spaced repetition](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition)) Flashcard Home 集中展示今日到期、周进度、每日目标与连续记录。([Flashcard Home](https://help.remnote.com/en/articles/7925835-the-flashcard-home)) | 不自己计算“接下来该复习什么”，只完成今天合理的一小批。 | 从学习记录中手动挑出值得记住的要点；首版用透明、固定的复习间隔，避免暴露复杂调度参数。 |
| Anki | 官方介绍的基本闭环是建立卡组和卡片、回忆答案、评价记忆程度，再由系统安排下一次复习；同时支持同步、多媒体、布局/复习时机定制和扩展。([Anki](https://apps.ankiweb.net/)) 官方手册区分新卡、学习中、复习和重学状态。([Anki manual](https://docs.ankiweb.net/getting-started.html)) | 用主动回忆维护长期记忆，并把更多时间放在薄弱内容上。 | 采用“忘记 / 模糊 / 记得”三档反馈即可；不要在首版复制卡组市场、富媒体模板、插件系统或高级调度设置。 |
| MyStudyLife | 官方页面把课程、作业、考试、活动与复习放进同一日历，提供提醒、专注模式、成绩跟踪和 AI 周计划；其核心入口先回答本学期与本周将发生什么。([MyStudyLife](https://mystudylife.com/)) | 避免漏掉截止日，在单一视图中知道今天和本周该做什么。 | “今天”首页比全功能资料库更重要。个人自学 MVP 只保留主题、下一步和可选目标日期，不复制课表轮换、成绩、LMS、家长端。 |

## TickTick / 滴答清单：借鉴执行闭环，不复制通用任务管理器

### 官方资料确认的当前机制

- **快速捕获与 Today**：当前功能页确认可通过桌面全局快捷键、小组件、浏览器入口、自然语言和语音快速添加；2026 年官方更新又在 Today 中加入“Suggested Tasks”，用于回看未完成任务并快速排进今天。([TickTick Features](https://ticktick.com/features), [2026 changelog](https://ticktick.com/public/changelog/en.html)) 官方既有产品指南把 Inbox 描述为先收下未排期内容的入口、Today 描述为当天行动视图；这篇指南发布时间较早，因此本文只借用“先捕获、后整理”的信息架构，不依赖其旧版界面细节。([TickTick Inbox / Today guide](https://blog.ticktick.com/2020/09/03/ticktick-my-productivity-app/))
- **拆解任务**：当前方案对比明确列出 Subtask、Recurring Task、Checklist Item 及清单项单独提醒；说明“一个行动项内继续拆小”是基础模型，不必升级成完整项目图。([TickTick plan comparison](https://ticktick.com/upgrade))
- **排期、重复与提醒**：当前功能页提供年、月、周、日程、多日和多周日历，并支持周/月/年/自定义重复、每日规划提醒、多次提醒和持续提醒。([TickTick Features](https://ticktick.com/features))
- **专注、习惯与统计**：TickTick 把 Pomodoro、习惯打卡和数据统计放在同一产品中；统计同时追踪任务、专注时长和习惯记录。([TickTick Features](https://ticktick.com/features)) 当前更新还确认专注记录可以补记超出原计时的时长，日历可以并排显示并拖入任务进行排期。([TickTick changelog](https://ticktick.com/public/changelog/en.html))
- **本地/离线边界**：本轮没有在 TickTick 当前官方产品或帮助页中找到“核心功能可离线”或“local-first”的明确承诺。相反，官方首页强调跨设备实时同步，安全页说明用户数据托管并备份于 AWS。([TickTick](https://ticktick.com/), [TickTick Security](https://ticktick.com/security?language=en_US)) 因而可以借鉴其交互模式，但不能把 TickTick 当作本项目本地优先架构的依据。

### 转译到学习助手：采用 7 个模式

1. **学习收件箱**：任何页面都能快速记下一句话，未归类记录先进入“待整理”，不强迫用户当场填写完整字段。
2. **今天视图**：把“到期回顾、计划学习、上次未完成”合成一个行动队列，并允许一键推迟或标记本次不做；不让资料库承担今日决策。
3. **轻量拆解**：一条学习记录可有最多几条检查项/下一步，例如“看课程 → 跑示例 → 写结论”；仍由一条记录承载结果反思。
4. **可选排期与重复**：记录可选目标日期；只为“每天练习、每周复盘”等学习节律提供简单重复，不让用户维护复杂日历规则。
5. **从记录直接专注**：开始计时不再创建第二份任务；完成或中断后，实际时长、状态和反思自动写回同一证据链。
6. **习惯只做启动器**：习惯代表可重复的学习仪式，如“英语跟读 15 分钟”，打卡时仍应生成会话或记录；避免出现与学习证据脱节的空打卡。
7. **统一但克制的统计**：把计划完成、实际专注、记录产出和到期回顾放在同一周视图，用主题归因回答“时间花在哪里、留下了什么”。

### 明确排除的通用任务管理器功能

- 不做工作、购物、生活等无限清单体系，也不做通用任务模板市场；学习主题就是最高层分类。
- 不做年历、多周日历、时间线/Gantt、看板、四象限和倒数日；首版只需要今天、未来 7 天和可选目标日期。
- 不做成员指派、共享清单、评论、活动日志、第三方日历/Notion 集成。
- 不做位置提醒、持续响铃、邮件提醒和时区旅行规则；只保留温和的本地到期/每日回顾提醒。
- 不做任务优先级矩阵、复杂筛选器、主题商店、清单背景或虚拟奖励经济。
- 不继承 TickTick 的账号、实时同步和云端托管前提；本项目仍以无需登录、离线可用、可导入导出为验收边界。

## 重复出现的 Jobs-to-be-Done

1. **快速留下学习证据**：我刚看完、练完或想通一件事时，能在几十秒内记下主题、来源、收获和下一步，不打断学习状态。这个需求在 Notion 的结构化笔记、Reader 的保存/标签/备注链路中都存在。([Notion semester guide](https://www.notion.com/help/guides/get-organized-for-a-new-semester-with-notion), [Reader saving](https://docs.readwise.io/reader/docs/saving-content))
2. **马上开始，而不是继续规划**：当我知道该学什么时，可以从记录直接启动一次专注；Forest 与 Focus To-Do 都把计时放在行动链路中心。([Forest](https://www.forestapp.cc/), [Focus To-Do](https://www.focustodo.cn/?lang=en_US))
3. **知道这次到底学到了什么**：会话结束时补一条短反思，把“花了时间”与“形成理解”区分开。Readwise 的高亮/备注和 RemNote 的笔记到复习卡路径都体现了这种从输入到可复用知识的转换。([Reader highlights and notes](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes), [RemNote](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition))
4. **让重要内容在正确时机回来**：我无需翻历史，就能看到今天该回顾的少量内容；Readwise Daily Review、RemNote 到期队列和 Anki 调度都以“系统选择下一次出现时机”为核心。([Readwise](https://readwise.io/read/), [RemNote](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition), [Anki](https://apps.ankiweb.net/))
5. **看见可解释的长期进展**：我想知道本周在哪些主题上投入了时间、完成了多少次学习与回顾，而不是只看一个虚高总分。Forest 和 Focus To-Do 都按时间范围与主题/项目呈现历史，RemNote 展示近期复习进度。([Forest](https://www.forestapp.cc/), [Focus To-Do](https://www.focustodo.cn/?lang=en_US), [RemNote statistics](https://help.remnote.com/en/articles/7970392-flashcard-statistics))
6. **重新找到过去的材料与想法**：记录增多后，按主题、来源、状态和文本检索比继续堆首页卡片更重要；Reader 提供全文搜索与标签/过滤，Notion 提供数据库排序、过滤和不同视图。([Reader search](https://docs.readwise.io/reader/docs/faqs/searching), [Reader organization](https://docs.readwise.io/reader/docs/organizing-content), [Notion semester guide](https://www.notion.com/help/guides/get-organized-for-a-new-semester-with-notion))

## 建议的本地优先 MVP

### 产品边界

目标用户是“围绕多个自学主题持续学习的个人”，不是学校教务场景。产品承诺是：**每次学习都有记录、每条重要收获会回来、每周能看懂自己如何前进**。

本地优先不是一句隐私口号，而是一条验收约束：不登录也能完成记录、计时、回顾、搜索和统计；断网不影响核心流程；用户可以导出自己的数据。Forest 已证明核心专注链路可离线，Reader 明确把 local-first、离线阅读与 Markdown 导出作为产品能力。([Forest offline](https://www.forestapp.cc/), [Reader local-first](https://readwise.io/read/), [Reader export](https://docs.readwise.io/tools/cli))

### 四个核心对象

- **学习主题 Topic**：名称、颜色、目标/动机、状态。
- **学习记录 Entry**：标题、主题、时间、来源链接（可选）、一句收获、详细笔记（可选）、下一步、标签。
- **专注会话 Session**：关联主题/记录、计划时长、实际时长、完成/中断、结束反思。
- **回顾项 Review**：从一条记录中手动标记的关键点、下次回顾时间、最近反馈、回顾历史。

这四个对象分别承接“组织、捕获、行动、记忆”，足以覆盖上面的共性任务；课表、成绩、网页正文、聊天和社交不进入首版数据模型。

### 必须打通的四条链路

#### 1. 首次使用：90 秒产生第一条真实记录

`选择/新建一个主题 → 写一句今天要学什么 → 可选启动 25 分钟专注`

不要求先配置课表、目标体系、模板或 AI。完成标准：刷新或重启应用后，主题和记录仍存在。

#### 2. 学习会话：从意图到可验证结果

`今天页选择一条记录 → 一键开始/暂停/结束 → 填“我学会了什么 / 哪里还不懂 / 下一步” → 保存`

结束反思默认只展示三个短字段；详细笔记折叠。中断会话保留在时间线中，允许补充原因，不扣分、不弹羞辱式警告。Forest 也保留失败会话形成的“枯树”，并把它描述为诚实记录而非评判。([Forest FAQ](https://www.forestapp.cc/))

#### 3. 今日回顾：3–5 分钟清空到期内容

`今天页显示到期数量 → 展示一个关键点 → 用户先回忆再翻面 → 选择“忘记 / 模糊 / 记得” → 安排下次日期`

首版采用易解释的固定间隔，例如 `1 → 3 → 7 → 14 → 30 天`；“忘记”回到 1 天，“模糊”保持或退一级，“记得”前进一步。进阶算法不是 MVP 前提；Anki 官方也建议先使用默认设置一段时间，再调整复杂选项。([Anki deck options](https://docs.ankiweb.net/deck-options))

#### 4. 周回顾：用证据决定下一周

`查看过去 7 天 → 按主题查看专注分钟、完成/中断会话、创建记录、完成回顾 → 写一句本周总结 → 为一个主题设置下一步`

只提供能回答“时间去了哪里、留下了什么、下一步是什么”的指标。连续天数可以作为轻提示，但不成为核心成绩；RemNote 同时区分很小的连续目标与较大的每日目标，说明连续性适合做启动提示而不是唯一产出指标。([RemNote goals](https://help.remnote.com/en/articles/7950933-goals-and-streaks))

### 首版界面信息架构

- **今天**：快速记录、继续学习、到期回顾、本周简报。
- **主题**：主题卡片及进度；进入后按时间线查看记录、会话和回顾项。
- **记录库**：全文搜索；按主题、标签、来源、有无下一步、日期筛选。
- **回顾**：今日队列、稍后到期、简单历史。
- **设置**：默认专注时长、复习提醒开关、数据导入/导出、清空数据。

首页每次只突出一个主动作：有到期回顾时优先“开始回顾”；有进行中会话时优先“继续”；否则优先“记录今天学了什么”。这比同时暴露日历、图表、AI 对话和资料库更符合“先行动”的产品目标。

## 首版有意不做

| 暂不做 | 取舍理由 |
| --- | --- |
| 通用富文本知识库、网页剪藏与内置 PDF/EPUB 阅读器 | Reader 的官方功能覆盖保存、解析、阅读、标注、搜索和同步，已经是一条独立而庞大的产品线；MVP 只存链接、摘录和用户自己的结论。([Reader saving](https://docs.readwise.io/reader/docs/saving-content), [Reader](https://readwise.io/read/)) |
| AI 家教、自动总结、自动生成卡片/计划 | MyStudyLife 与 RemNote 已加入 AI 计划或制卡，但学习记录闭环本身并不依赖 AI；先验证用户是否持续记录和回顾，再考虑只对用户选中的本地记录提供可撤销建议。([MyStudyLife](https://mystudylife.com/), [RemNote](https://help.remnote.com/en/articles/8663109-flashcard-basics)) |
| 课表轮换、考试成绩、LMS、家长/教师协作 | 这些是 MyStudyLife 的学校场景优势，不是个人自学助手的必要条件。([MyStudyLife](https://mystudylife.com/)) |
| 好友、排行榜、组队专注、虚拟货币和复杂养成 | Forest 官方产品已将组队、排行榜、树种奖励发展成完整系统；本项目首版只借鉴“进展可见”，避免游戏系统吞没学习证据。([Forest](https://www.forestapp.cc/)) |
| 系统级应用/网站阻断 | 需要平台权限和大量边界处理；计时与记录可先验证价值，阻断不是学习记录成立的前提。Forest 将它作为专注工具层，而非记录本身。([Forest](https://www.forestapp.cc/)) |
| 高级 SRS 参数、共享卡组、插件与模板市场 | Anki 的定制、扩展和大规模卡组能力适合成熟记忆工具，但会显著增加首版认知成本。([Anki](https://apps.ankiweb.net/), [Anki manual](https://docs.ankiweb.net/getting-started.html)) |
| 账号、云同步和多人协作 | 与“无需登录、核心离线”的 MVP 验收目标冲突；先保证可靠的本地持久化和 JSON/Markdown 导入导出。 |

## MVP 验收标准

1. 新用户在 90 秒内创建主题和第一条学习记录，无需注册或配置模板。
2. 一条记录可以直接开始专注；结束后能留下实际时长、结果反思和下一步。
3. 用户能把某条收获加入回顾，并完成一轮“先回忆、再揭示、再自评”的到期队列。
4. 今天页能明确回答：现在最该做什么、还有多少条要回顾、正在继续哪个主题。
5. 主题页能按时间线还原“记录 → 会话 → 反思 → 回顾”的证据链。
6. 记录库支持文本搜索，以及主题、标签和日期筛选。
7. 周回顾至少显示按主题的专注时间、完成/中断会话数、记录数、完成回顾数，并能保存下一周的一句话行动。
8. 断网、刷新和重启后核心数据仍在；用户能导出并重新导入 JSON，学习记录可另导出为 Markdown。
9. 删除或清空数据前有明确确认；导出结果不依赖专有云服务才能读取。
10. AI、社交、云同步、课表/成绩和系统级阻断即使完全不存在，也不影响上述验收全部通过。

## v0.2 决策记录：TodoList、任务追踪与学习闭环

### 先看当前产品，不从空白功能表出发

本节先记录 v0.1 在 2026-09-04 开发前的基线，再记录已经落地的 v0.2 决策。v0.1 已有 `主题 → 可验收步骤 → 专注会话 → 收获/证据/卡点/下一步 → 1/3/7 日复习 → 周回顾`，并用 IndexedDB / SQLite 做本地持久化。

当时识别出的缺口不是“再加一个普通清单”，而是以下五处断点；这些断点现已由 `StudyState v2`、`StudyTask` 和四个一级入口解决：

- `StudyStep` 只有标题、验收条件、预计时长和单个 `scheduledOn`，没有待整理/进行中/完成/取消等显式状态；目前完成进度由“是否存在关联完成会话”推导。([study model](../src/storage/study/types.ts), [App](../src/App.vue))
- 今天页只选择当前主题的第一个未完成步骤，并非跨主题的 Inbox / Today 行动队列；`scheduledOn` 尚未形成逾期、今天、稍后和无日期的完整语义。([App](../src/App.vue), [TodayView](../src/components/study/TodayView.vue))
- 验收项的勾选结果单独写在 `localStorage`，不属于版本化 `StudyState`，也不进入学习数据导入导出。([App](../src/App.vue), [study model](../src/storage/study/types.ts))
- 当前没有学习标签、全局搜索、重复学习步骤、习惯或本地提醒；周回顾只有会话次数、分钟、单条进展/卡点/下一步。([ReviewView](../src/components/study/ReviewView.vue), [study model](../src/storage/study/types.ts))
- 脚手架仍保留一个未接入拾学 UI 的通用 Todo 数据口，字段只有 `title / done / created_at`。它适合证明存储适配器，不足以表达验收条件、证据和复习。([Todo model](../src/storage/todos/types.ts), [Todo port spec](./superpowers/specs/2026-09-03-todo-data-port.md))

### 现有产品给出的任务机制

| 产品 | 当前官方一手资料确认的机制 | 对拾学的有效启发 |
| --- | --- | --- |
| Things | Inbox 是未处理想法的临时入口；Today 跨项目聚合开始日、截止日或重复规则命中的事项，Upcoming / Anytime / Someday 控制事项何时进入注意力，完成或取消后进入可搜索 Logbook。([Things default lists](https://culturedcode.com/things/support/articles/4001304/)) 它把 start date 与 deadline 分开，并支持项目/区域、标签、清单、标题分组和按完成后或固定日历重复。([Scheduling](https://culturedcode.com/things/support/articles/2803579/), [Projects and checklists](https://culturedcode.com/things/features/), [Tags](https://culturedcode.com/things/support/articles/2803581/), [Repeating to-dos](https://culturedcode.com/things/support/articles/2803564/)) | “何时进入注意力”比堆优先级更重要；收件箱、今天、稍后、完成/取消历史适合拾学，但 Area / Project 两级不必照搬。 |
| Todoist | Quick Add 可在一个输入框中写入日期、标签、提醒等，桌面全局快捷键允许在其他应用上方捕获。([Quick Add](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz)) 项目、标签、筛选器和子任务负责组织，重复日期在完成当前事项后生成下一次；日历可用周/月布局排期。([Projects](https://www.todoist.com/help/todoist/features/introduction-to-projects-TLTjNftLM), [Labels](https://www.todoist.com/zh-CN/help/todoist/features/introduction-to-labels-dSo2eE), [Sub-tasks](https://www.todoist.com/help/todoist/features/use-sub-tasks-in-todoist-kMamDo), [Recurring dates](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV), [Calendar](https://www.todoist.com/help/todoist/features/use-the-calendar-layout-in-todoist-lPHRQTu0o)) 效率视图统计日/周完成数与目标进度。([Productivity view](https://www.todoist.com/zh-CN/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9)) | 快速捕获、标签与子任务值得借鉴；“完成任务数/Karma”不能直接等同于学习效果，拾学应统计证据与复习。 |
| TickTick / 滴答清单 | 当前官方功能把快速添加、清单/标签/筛选、重复提醒、日历、番茄专注、习惯和任务/专注/习惯统计连在一起。([TickTick Features](https://ticktick.com/features)) | 证明计划、执行、习惯、统计可以在一个入口闭环；拾学应把它们收窄到学习语义，不能复制整个通用任务管理器。 |
| MyStudyLife | 课程、作业、考试、成绩、提醒、复习计划和专注模式共同形成面向学生学期的 Today / week 视角。([MyStudyLife](https://mystudylife.com/)) | “今天/本周有什么”应清晰，但自学产品无需课表轮换、成绩、LMS 或家长端。 |
| Forest / Focus To-Do | Forest 把计时、视觉积累、应用阻断和按日/周/月的专注统计连接起来，核心计时与统计可离线；Focus To-Do 把任务、子任务、截止日、重复、提醒、备注、Pomodoro 与历史报告连接起来。([Forest](https://www.forestapp.cc/), [Focus To-Do](https://www.focustodo.cn/?lang=en_US)) | 计划时长和实际专注必须归因到同一学习步骤；中断也应保留为真实记录。系统级阻断不是下一版前提。 |
| Anki / RemNote | Anki 根据用户对回忆程度的评价安排下一次复习；RemNote 的全局队列只展示到期卡片，并提供今日目标、连续记录、练习历史和未来负载预测。([Anki](https://apps.ankiweb.net/), [RemNote queue](https://help.remnote.com/en/articles/6022755-getting-started-with-spaced-repetition), [RemNote statistics](https://help.remnote.com/en/articles/7970392-flashcard-statistics)) | Todo 完成不是闭环终点；真正重要的收获要进入回顾队列，统计还应显示复习负载与记忆状态。 |

### P0：先补齐“捕获 → 今天 → 完成/取消 → 留证据”

| 功能 | 最小产品定义 | 验收标准 |
| --- | --- | --- |
| 学习收件箱与全局快速添加 | 在任何主页面用一个入口只填标题即可保存；默认进入“待整理”，之后再补主题、预计时长、验收条件和计划日期。借鉴 Things Inbox 与 Todoist Quick Add，但首版不解析复杂自然语言。([Things Inbox](https://culturedcode.com/things/support/articles/4001304/), [Todoist Quick Add](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz)) | 3 秒内保存一条想法；不选主题也不会丢失；可从待整理列表归档、删除或转成学习步骤。 |
| 跨主题“今天”队列 | 确定性合并：进行中会话 → 到期复习 → 逾期步骤 → 今日步骤 → 用户手动置顶；支持拖动排序、移到明天、移回稍后。Things Today 本质上也是跨项目的日期过滤器，而非独立项目。([Things Today](https://culturedcode.com/things/support/articles/4001304/)) | 两个主题各有今日步骤时能同时出现；延后只改变注意时间，不伪造完成；刷新后顺序与状态保持。 |
| 学习步骤状态机 | 把步骤扩展为 `inbox / planned / in_progress / completed / canceled`，记录 `completedAt / canceledAt`；完成仍要求一条收获或证据，取消保留原因并进入历史。Things 将完成和取消都送入 Logbook，适合作为“真实历史”参考。([Things Logbook](https://culturedcode.com/things/support/articles/4001304/)) | 完成、取消、撤销、重新打开都有可测试迁移；进度分母不会因删除困难步骤而悄悄变化；历史可追溯。 |
| 持久化检查项与步骤编辑 | 验收项勾选进入版本化学习状态；可新增、重排、编辑步骤及验收项，不再只编辑当前步骤标题和时长。Things 用 checklist 处理无需升级为完整项目的细分动作，Todoist 用 sub-task 拆解大型事项。([Things checklists](https://culturedcode.com/things/features/), [Todoist sub-tasks](https://www.todoist.com/help/todoist/features/use-sub-tasks-in-todoist-kMamDo)) | JSON 导出/导入保留步骤状态、顺序和勾选项；旧数据迁移后结果不变；检查项本身不计作独立“学习完成”。 |
| 计划时间与截止边界 | 将“计划开始日”和“真正截止日”分开；学习步骤通常只设置计划日，考试/交付等少数场景才设置 deadline。Things 官方明确区分 start date 与 deadline。([Things scheduling](https://culturedcode.com/things/support/articles/2803579/)) | 无日期、今日、未来、逾期和有截止日五类都能稳定排序；改变计划日不改变截止日。 |

P0 没有新建第二套 Todo UI。最终方案把学习任务统一为 `StudyTask`，旧 `StudyStep` 只参与 v1 → v2 迁移；脚手架通用 Todo 数据口继续兼容但不接入学习 UI，也不镜像写入。

### P1：让计划可持续、历史可检索

| 功能 | 产品定义与边界 | 官方模式依据 |
| --- | --- | --- |
| 重复学习节律 | 支持每天/每周/指定星期，以及“完成后 N 天”两类；每次只生成一个当前实例，完成实例后保留证据再生成下一次，避免逾期副本堆叠。 | Things 同时支持固定日历与完成后重复，Todoist 也区分基于原计划和完成日的重复。([Things repeat](https://culturedcode.com/things/support/articles/2803564/), [Todoist recurring dates](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV)) |
| 轻量标签与全局搜索 | 主题负责“学什么”，标签只表达跨主题上下文，例如 `阅读 / 实作 / 输出 / 低精力`；搜索覆盖步骤、收获、证据、卡点和下一步，并可组合主题、状态、日期筛选。 | Things 标签用于跨清单连接与过滤；Todoist 标签与筛选器能组合日期、项目和状态。([Things tags](https://culturedcode.com/things/support/articles/2803581/), [Todoist filters](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH)) |
| 温和的本地提醒 | 只提供计划开始、真正截止、到期复习和每日回顾四类提醒；默认不重复轰炸，通知可直接“开始 / 明天 / 稍后”。 | TickTick 与 Todoist 都提供多种任务/重复提醒；拾学应取其及时性而非持续响铃或位置提醒。([TickTick reminders](https://ticktick.com/features), [Todoist reminders](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU)) |
| 学习习惯作为派生视图 | 用户可以设“每周三次英语跟读”之类节律；只有生成并完成学习会话/记录才算打卡，不能存在与证据链分离的空勾选。 | TickTick 把习惯与任务、专注统计并列；RemNote 把很小的连续目标和完整每日目标分开。([TickTick habits](https://ticktick.com/features), [RemNote goals](https://help.remnote.com/en/articles/7950933-goals-and-streaks)) |
| 可解释统计与历史 | 增加按主题的计划/完成/取消、预计/实际时长、证据覆盖率、到期/完成复习、重复卡点；可点击指标回到原记录。连续天数只作提示。 | Focus To-Do 和 Forest 都按时段/项目或标签追踪专注；Todoist 展示日/周完成目标；RemNote 进一步展示练习历史和未来负载。([Focus To-Do](https://www.focustodo.cn/?lang=en_US), [Forest analytics](https://www.forestapp.cc/), [Todoist productivity](https://www.todoist.com/zh-CN/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9), [RemNote statistics](https://help.remnote.com/en/articles/7970392-flashcard-statistics)) |

### P2：在真实使用数据出现后再增强

- **未来 7 天 / 周日历**：用无日期侧栏把步骤拖入某天或时间块，并显示专注会话与复习负载；不先做月/年/多周视图。Todoist 的日历也以周/月排期和把无日期任务拖入日期为核心。([Todoist calendar](https://www.todoist.com/help/todoist/features/use-the-calendar-layout-in-todoist-lPHRQTu0o))
- **复习负载预测与可解释调度**：显示未来 7 天到期量、单条回顾历史和掌握趋势；积累足够真实反馈后，再评估从固定 1/3/7 日升级算法。RemNote 的统计提供练习历史、掌握等级和未来卡片预测。([RemNote statistics](https://help.remnote.com/en/articles/7970392-flashcard-statistics))
- **主题里程碑与阶段标题**：当一个主题稳定超过约 10 个步骤时，再用 Things headings 类似的分组表达阶段；不增加 Area → Project → Section → Task 的四层结构。([Things headings](https://culturedcode.com/things/features/))
- **保存的智能视图**：允许保存“本周低精力可做”“逾期且尚无证据”等筛选；规则必须确定、可见、可编辑，不让模型暗中决定排序。Todoist 与 Things 都允许基于标签/时间建立聚焦视图。([Todoist filters](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH), [Things Quick Find](https://culturedcode.com/things/support/articles/2803584/))
- **可选 AI 辅助拆解**：只基于用户当前主题和目标给出候选步骤、验收条件或周计划，必须预览后逐条接受；不得自动改日期、完成任务或生成学习证据。

### 明确不建议

- **不克隆通用 TodoList**：不做购物、工作、家庭清单，不以“支持一切任务”为卖点；通用范围会稀释拾学独有的验收、证据与复习闭环。
- **不以完成数量、连续天数或积分作为核心成功指标**：Todoist 的完成数/Karma、TickTick 的习惯统计可用于激励，但拾学的主指标应是“完成且有证据的步骤、复习完成和主题推进”。([Todoist productivity](https://www.todoist.com/zh-CN/help/todoist/features/use-the-productivity-view-in-todoist-6S63uAa9), [TickTick statistics](https://ticktick.com/features))
- **不先做重日历和项目管理视图**：月/年日历、看板、四象限、Timeline/Gantt、依赖图在当前数据量下只会增加维护和排期负担。
- **不做空打卡习惯**：任何学习习惯都必须落到实际会话、记录或复习；否则用户会得到“连续很多天但没有学会任何东西”的假进度。
- **不自动堆积重复任务**：错过一次不生成一串逾期副本；下一次应基于用户选择的固定节律或实际完成时间计算。
- **不把应用阻断、社交/排行榜、成员指派、评论协作、位置提醒、持续响铃、主题商店放进 P0/P1**：这些分别属于专注工具、团队任务或增长系统，而非当前学习证据链的断点。([Forest](https://www.forestapp.cc/), [TickTick Features](https://ticktick.com/features), [Todoist projects](https://www.todoist.com/help/todoist/features/introduction-to-projects-TLTjNftLM))
- **不在使用数据不足时升级 SRS 或引入 AI 自动规划**：先记录回顾完成率、`clear / fuzzy / relearn` 分布、延期和重学行为，再决定算法；模型建议永远不能替代用户的完成证据。

### v0.2 成功标准

1. 用户能在 3 秒内捕获一个未归类学习想法，并在稍后把它转成带验收条件的主题步骤。
2. 今天页能正确聚合至少三个主题的进行中、到期复习、逾期和今日步骤；所有排序规则可说明且无需模型判断。
3. 步骤完成、取消、延期、撤销和重开都有持久化状态与历史；刷新、重启、导出/导入后保持一致。
4. “完成学习步骤”必须关联至少一条收获或证据；检查项、习惯打卡和普通任务勾选都不能绕过这条规则。
5. 周回顾可从每个统计数字返回原始步骤/会话/复习记录，并区分计划、实际、取消和未完成。
6. P0 完成时，一级导航为“今天 / 任务 / 主题 / 回顾”；“任务”只管理学习工作状态，“回顾”只管理学习成果，两者共享事实源而不重复建档。

## 后续只在数据证明后扩展

- 如果用户持续记录但很少回顾：先优化回顾入口、数量与文案，再考虑更复杂的调度算法。
- 如果用户频繁粘贴来源且手工摘录成为主要阻力：再增加浏览器分享或轻量剪藏，不先做完整阅读器。
- 如果用户有稳定反思文本且主动要求整理：再增加本地或可选模型的摘要、问题生成；AI 输出必须可预览、可编辑、可拒绝。
- 如果用户明确需要跨设备：先做端到端可恢复的数据同步，再做协作和社交。
