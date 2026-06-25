# 好友保护 · 后端接入指南

**版本**: 0.2.0
**状态**: 前端已完成,后端已接入真实好友列表 API,真实账号集成测试待验证

---

## 概述

好友保护功能允许用户在执行屏蔽时跳过名单中的好友,避免误操作。前端契约已完整,后端已实现**好友列表拉取**逻辑。

### 用户体验
- 执行确认页显示"跳过列表中的好友(推荐)"复选框,默认勾选。
- 开启后,名单中是好友的 uid 自动跳过,报告中标记为"好友跳过"(金色,区别于灰色手动跳过)。
- 关闭时行为不变,正常执行所有非手动跳过的条目。

---

## 前后端契约

### 前端 → 后端

`StartRunRequest` 新增字段:
```rust
#[serde(default = "default_skip_friends")]
pub skip_friends: bool,  // 默认 true
```

前端在确认页读取复选框状态,传给后端。

### 后端 → 前端

1. **新增状态枚举**:
   ```rust
   pub enum RunItemStatus {
       // ... 其他状态
       SkippedFriend,  // 序列化为 "skipped_friend"
   }
   ```

2. **RunSummary 新增计数**:
   ```rust
   #[serde(default)]
   pub skipped_friend: usize,
   ```
   前端把 `skipped_friend` 同时计入 `skipped` 总数,UI 统一显示"跳过"。

3. **RunItemResult 示例**:
   ```json
   {
     "rowIndex": 42,
     "uid": "usr_abc...",
     "memo": "某好友",
     "status": "skipped_friend",
     "note": null,
     "block": null,
     "attempts": 0,
     "error": "已跳过：该用户是你的好友"
   }
   ```

---

## 后端接入点

### 1. VrchatClient 新增方法

**文件**: `src-tauri/src/vrchat/client.rs`

在 `VrchatClient` 上新增 `friends` 方法,参考 `user_notes` 的分页写法:

```rust
/// 拉取好友列表(分页)。
/// - `offset`: 起始偏移
/// - `n`: 每页数量(建议 100)
/// - `offline`: true 拉离线好友,false 拉在线+活跃
pub async fn friends(
    &self,
    offset: usize,
    n: usize,
    offline: bool,
) -> AppResult<ApiResponse<Vec<Friend>>> {
    let offline_param = if offline { "true" } else { "false" };
    self.get(&format!("auth/user/friends?offline={offline_param}&n={n}&offset={offset}"))
        .await
}
```

**Friend 结构体**(新建 `src-tauri/src/vrchat/friends.rs`):
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub id: String,  // usr_... 格式
    // 其他字段(displayName 等)可选,本功能只需 id
}
```

### 2. 填充 collect_friend_uids

**文件**: `src-tauri/src/commands/run.rs`

当前实现已接入真实拉取:

```rust
async fn collect_friend_uids(
    client: &VrchatClient,
    policy: &RetryPolicy,
) -> HashSet<String> {
    let mut uids = HashSet::new();
    let page_size = 100;

    // 拉取在线+活跃好友(offline=false)
    let mut offset = 0;
    loop {
        let response = match retry_api(policy, || {
            client.friends(offset, page_size, false)
        })
        .await
        {
            Ok((resp, _attempts)) => resp,
            Err(error) => {
                log::warn!("拉取在线好友失败(offset={offset})：{error}");
                break;
            }
        };

        let friends = response.value;
        for friend in &friends {
            uids.insert(friend.id.clone());
        }

        if friends.len() < page_size {
            break;
        }
        offset += page_size;
    }

    // 拉取离线好友(offline=true),逻辑同上
    offset = 0;
    loop {
        let response = match retry_api(policy, || {
            client.friends(offset, page_size, true)
        })
        .await
        {
            Ok((resp, _attempts)) => resp,
            Err(error) => {
                log::warn!("拉取离线好友失败(offset={offset})：{error}");
                break;
            }
        };

        let friends = response.value;
        for friend in &friends {
            uids.insert(friend.id.clone());
        }

        if friends.len() < page_size {
            break;
        }
        offset += page_size;
    }

    uids
}
```

**注**:需从 `run_engine` 导入 `retry_api` 或定义类似重试逻辑,处理 429/5xx。

---

## VRChat API 规格

**Endpoint**:
```
GET /api/1/auth/user/friends?offline={bool}&n={int}&offset={int}
```

**参数**:
- `offline`: `true`(离线好友) | `false`(在线+活跃好友)
- `n`: 每页数量(建议 100)
- `offset`: 分页起始偏移

**响应** (JSON 数组):
```json
[
  {
    "id": "usr_00000000-0000-4000-8000-000000000001",
    "displayName": "Friend Name",
    "currentAvatarImageUrl": "...",
    "userIcon": "...",
    "bio": "...",
    "statusDescription": "...",
    "location": "...",
    "friendKey": "...",
    // ... 其他字段
  }
]
```

**重要**: 每个对象的 `id` 字段是 `usr_` 开头的 uid,这是判定好友的唯一标识。

**分页**: 循环请求直到返回条目数 < `n`,表示已拉完。

---

## 测试要点

### 单元测试
1. **好友集合正确传递**: `execute_block_run` 收到非空 `friend_uids` 时,名单中匹配的 uid 产出 `SkippedFriend` 状态。
2. **空集时行为不变**: `friend_uids` 为空时,所有条目按原逻辑执行(手动跳过、block 等),不受影响。
3. **summarize 计数准确**: `SkippedFriend` 同时计入 `skipped` 和 `skipped_friend`。

### 集成测试
1. **真实好友拉取**: 用测试账号拉取好友列表,验证返回的 uid 格式和分页逻辑。
2. **跳过逻辑**: 构造包含测试账号好友的名单,开启好友保护执行,确认:
   - 好友条目状态为 `skipped_friend`,不执行 block。
   - 非好友条目正常屏蔽。
   - 报告中 `skipped_friend` 计数准确。
3. **关闭保护**: 复选框不勾选时,`skip_friends` 为 false,好友也正常屏蔽(危险但需支持)。

### 边界情况
- 好友列表为空(新号或无好友): `collect_friend_uids` 返回空集,行为等同关闭保护。
- 拉取失败(401/网络错误): 当前实现会记录 warn 并返回已成功拉取到的好友集合；如果两组分页都失败则等同空集,可接受(保护失效但不阻塞执行)。后续可优化为拉取失败时弹错提示、用户决定是否继续。
- 名单全是好友: 所有条目 `SkippedFriend`,报告显示 0 成功、N 跳过,用户从报告中清晰看到。

---

## 前端已完成

- ✅ 确认页复选框 UI + i18n(中日英)
- ✅ 传 `skipFriends` 给后端
- ✅ 时间线 `friend` pill(金色 `FRIEND` 标签)
- ✅ 报告表格 `skipped_friend` 状态行(金色"好友跳过")
- ✅ 导出失败 CSV 时过滤 `skipped_friend`(不算失败)

---

## 后端 TODO 清单

- [x] 新建 `src-tauri/src/vrchat/friends.rs`,定义 `Friend` 结构体
- [x] `src-tauri/src/vrchat/client.rs` 加 `friends()` 方法
- [x] `src-tauri/src/vrchat/mod.rs` 导出 `pub mod friends;`
- [x] `src-tauri/src/commands/run.rs` 的 `collect_friend_uids` 填充真实拉取逻辑
- [ ] 集成测试:用真实账号验证好友拉取和跳过逻辑
- [ ] (可选)拉取失败时的 UX 优化:弹错让用户决定是否继续

---

## 参考

- **原始需求**: 用户报告第一个版本误屏蔽了好友,0.2.0 加此功能避免。
- **设计决策**: 默认开启(安全优先),放确认页(每次可调),跳过而非中止(透明度)。
- **前端实现**: `vrc-blocker-app/public/app.js` 搜索 `skipFriends` / `skipped_friend` 查看完整流程。
- **后端骨架**: `src-tauri/src/commands/run.rs:collect_friend_uids` 和 `src-tauri/src/run_engine/mod.rs` 循环跳过逻辑。
