# 限速与指数退避

## 策略目标

这个工具不需要过度保守。正常情况下应尽量快，但遇到 VRChat 明确限速或临时错误时必须收敛，避免把账号请求打进持续 429。

## 正常节奏

建议执行模型：

- 单账号串行处理每个 UID。
- 每条记录内部按固定顺序执行：写备注、验备注、block、验 block。
- 正常成功请求之间不做秒级固定等待。
- 每条记录之间可加很小的抖动，例如 150-350 ms，避免完全机械间隔。
- UI 层显示实时进度，后端保留暂停/取消入口。

不建议：

- 固定每个请求等待 1.5-3 秒。
- 多并发对同一个账号同时写备注和 block。
- 不看 `Retry-After` 就盲目指数退避。

## 退避规则

当前骨架的默认 `RetryPolicy`：

```json
{
  "maxAttempts": 5,
  "baseDelayMs": 700,
  "maxDelayMs": 30000
}
```

处理规则：

- `429`：优先使用响应头 `Retry-After`。如果没有，再进入指数退避。
- `5xx` 或网络断开：指数退避，最大 30 秒。
- `401/403`：不重试单条记录，暂停整批任务并要求重新登录。
- `400/404`：默认视为永久失败，除非后续验证接口能证明目标状态已经达到。
- 成功若连续出现，可以清空当前 penalty，不把历史慢速状态带到后续所有请求。

指数退避公式：

```text
delay = min(maxDelayMs, baseDelayMs * 2^(failedAttempt - 1) + jitter)
```

其中 `jitter` 是 0-250 ms 的小抖动。这样第一轮失败大约 0.7-1.0 秒后重试，不会一开始就慢到不可用。

## 已经屏蔽的玩家

最稳的处理方式是避免依赖重复 block 的返回码：

1. 执行前 `GET /auth/user/playermoderations`。
2. 如果目标 UID 已经存在 `type=block`，仍然覆盖写入 `userNotes`。
3. 备注验证通过后，单条记为 `already_blocked`，不再 POST block。

如果执行中没有预先发现，但 `POST /auth/user/playermoderations` 返回类似重复/冲突错误：

1. 不立即判失败。
2. 再 `GET /auth/user/playermoderations`。
3. 如果验证到 UID 已经 block，则记为 `already_blocked` 或 `success`。
4. 如果仍未验证到 block，再按 HTTP 分类处理失败或重试。

这样不需要猜 VRChat 对重复 block 的具体错误码。实际实现时仍应把原始 HTTP status 和 message 写进报告，便于后续校正。
