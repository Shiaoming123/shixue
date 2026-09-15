# Apple-Design 应用审查

日期：2026-09-11。用户选择最近 iOS/UI 重构版本；独立工作树基于 `a41c81b`。未移动或覆盖源工作树未提交的产品文档，没有提交、推送或发布。

## 依据与边界

使用本次改写的全局 `apple-design` Skill（显示名 Apple-Design），以 Apple Design、Design Pathway、HIG 六大分支为依据。Skill 将来源、官方提炼、工程映射和未完整读取的低频主题区分记录；不是 Apple 官方认证或全部原文翻译。

沿用当前 DESIGN.md 的已确认导航与 Glass Chrome，不引入新布局、功能、材质框架或依赖。当前产品文档草案中的“通用任务优先、学习可选、本地优先、Windows 核心闭环”作为约束，不把它们当作已发布功能证明。

## 复现 → 最小修复

| 当前证据 | 影响 | 修改与依据 |
| --- | --- | --- |
| 日程标题 input.required 为 false；月份没有 min/max | 表单语义与调用者声明不一致，原生校验缺失 | Input 透传属性到原生控件；HIG Entering data / Accessibility |
| Input 清除 outline，强制色彩下阴影不显示 | 键盘焦点只剩细边界，不足以明确区分 | 强制色彩使用 2px Highlight outline；共享焦点环提高到 2px 不透明强调色 |
| 深色提高对比时侧栏仍为 72% 透明、blur(24px) | 用户降低视觉干扰的偏好未生效 | 高对比与减少透明度共用不透明回退；选择器覆盖 dark 的优先级；HIG Materials |
| 390px、200% CSS 文字下长日历名撑宽整个表单，关闭按钮离屏 | 无法完整读操作名称，关键退出入口不可见 | 共享 Button/Checkbox 允许换行、约束宽度，Input 可收缩；HIG Layout / Typography |
| 减少动效只缩短时长，按压 scale 仍存在 | 仍有不必要的文字缩放 | 使用现有 press-scale token 在偏好下设为 1；HIG Motion |

共享 Input 修复同时服务日历编辑、日历来源、任务重复规则、日历筛选与跟进任务。保留外层 class/style 和 label/id 对应，现有领域数据校验仍由服务负责。

## 验证说明

新增浏览器断言在修改前明确失败五项：required、数字范围、强制色彩焦点、深色高对比、长操作标签。既有桌面冒烟在修改前通过。修复后按 VISUAL_QA.md 运行新增及原有检查，并检查对应截图。

运行入口：

```powershell
npm run doctor
npm run verify
npm run smoke:desktop-shell
```

所有测试使用隔离端口与临时浏览器上下文中的演示数据。长日历名只创建于测试上下文；不访问真实本地数据库或云端。

2026-09-11 实际结果：

- `npm run verify` 通过：1009/1009 测试、协议、CSP、desktop/web/mobile 模块、类型、desktop/web 构建、布局与文档链接。
- 增强后的 `npm run smoke:desktop-shell` 通过：上述修复断言、减少动效按压、长复选标签与底部保存可达，及原有四档窗口流程；console/page error 为零。
- 森林绿、暖阳橙和自定义紫色深色模式完成浏览器抽查与截图；没有把抽查写成全主题全页面认证。
- Skill 官方格式校验、参考相对链接检查、DocC 读取脚本自检通过。Python YAML 校验依赖安装在本次任务产物目录，没有添加项目依赖。
- 构建仍提示既有大块体积及 Tauri 混合静态/动态导入警告，未在本轮做无关打包重构。

截图不代替断言，静态测试不代替浏览器。Web/Edge 结果不能升级为 Tauri、iOS/Android 真机、原生通知或真实读屏完成。此轮未改变字体缩放设置范围，也不宣称全产品已通过 200% 系统字体审查。
