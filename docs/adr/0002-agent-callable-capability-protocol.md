# ADR-0002：Agent 可调用的应用能力协议

- 状态：已接受
- 日期：2026-09-04

## 背景

未来“小拾”需要通过对话检索信息并执行任务增删改与复杂链路。当前阶段不实现模型、对话、工具选择、联网检索、记忆或任务编排，但如果 UI 继续直接操作快照，后续接入 Agent 会产生第二套业务入口、权限遗漏和不可审计写入。

## 决策

1. 建立版本化 `CapabilityQuery` / `CapabilityCommand` DTO 与统一 `TaskCapabilityService`；现有 UI 逐步改为调用该服务。
2. 每个命令声明 `risk`、`scope`、`reversibility` 和是否要求预演；执行入口接受 `idempotencyKey`、`expectedWorkspaceRevision` 与可选实体 revision。
3. `preview()` 不写入，返回校验错误、影响实体、结构化差异和确认等级。需确认的 preview handle 仅保存在当前 `TaskCapabilityService` 实例内存中，并绑定请求指纹、工作区 revision、命令类型和过期时间；不得进入 `WorkspaceState`、改变 revision/`updatedAt`，也不得跨服务实例复用。`execute()` 以原子批次执行，返回事件、最新 revision、结构化结果与可选 `UndoToken`。
4. 可逆单项写入默认可直接执行并展示撤销；删除、批量、导入覆盖、整个系列修改及未来外部写入必须先预演并确认。
5. 审计记录使用调用来源 `human-ui | keyboard | notification | agent`，但来源不改变领域规则；“自主”权限也不能越过红线动作。
6. 协议只描述本地应用能力，不导入模型供应商、聊天消息、工具注册、执行卡片或长期记忆类型。

## 后果

- 优点：UI 与 Agent 共享校验、事务、审计和撤销；权限策略可以基于机器可读元数据实现。
- 成本：第一阶段需从 `src/lib/study.ts` 提取领域服务，并维护契约演进测试。
- 兼容性：协议主版本仅在破坏性变更时提升；新增可选字段与新命令保持向后兼容。
- 兼容性：旧 v3 快照若含 `previewReceipts`，读取时只校验其旧结构并丢弃，不能恢复或授予确认权限。

## 被拒绝的方案

- Agent 直接调用存储适配器：无法保证业务不变量和权限。
- 在接入聊天时再设计协议：会让已有 UI 成为无法复用的旁路。
- 当前阶段预先实现 Agent 编排：没有模型与权限产品验证，属于超范围推测。
