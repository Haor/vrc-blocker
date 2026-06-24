# 后端契约

## 目标

本工具的核心动作是批量屏蔽 VRChat 玩家，并把导入 CSV 的 `memo` 覆盖写入在线 `userNotes`。备注策略只有一种：覆盖。

执行顺序固定：

1. 校验登录态。
2. 读取当前 player moderations，建立已屏蔽 UID 集合。
3. 对每条未跳过记录覆盖写入 `userNotes`。
4. 通过 `GET users/{uid}` 验证在线备注。
5. 如果该 UID 已经在 block 集合中，记录为 `already_blocked`，不重复 POST block。
6. 如果未屏蔽，调用 player moderation block。
7. 再读取 player moderations 验证 block 结果。

## Tauri Commands

前端只调用 commands，不直接拼 VRChat URL、Cookie 或 Basic Auth。

| Command | 状态 | 说明 |
| --- | --- | --- |
| `get_session_status()` | scaffold | 返回当前本地会话状态 |
| `login(request)` | scaffold | 后续接 `GET auth/user` + Basic Auth |
| `verify_two_factor(request)` | scaffold | 后续接 TOTP / Email OTP verify |
| `logout()` | scaffold | 后续清理本地 Cookie / keyring |
| `parse_import_file(path)` | implemented | 读取 UTF-8 CSV |
| `parse_import_text(text, sourceName)` | implemented | 解析文本 CSV，方便 prototype 调试 |
| `validate_rows(rows)` | implemented | 重新校验行数据 |
| `example_csv()` | implemented | 返回脱敏示例 CSV |
| `start_block_run(request)` | scaffold | 目前只支持 dry-run 报告；真实网络执行未打开 |
| `get_settings()` | scaffold | 返回默认设置 |
| `save_settings(settings)` | scaffold | 回传设置，后续落盘 |

## VRChat API

Base URL:

```text
https://api.vrchat.cloud/api/1
```

登录态：

```http
GET /auth/user
Authorization: Basic <base64(urlencoded username: urlencoded password)>
```

TOTP：

```http
POST /auth/twofactorauth/totp/verify
```

Email OTP：

```http
POST /auth/twofactorauth/emailotp/verify
```

覆盖在线备注：

```http
POST /userNotes
Content-Type: application/json

{
  "targetUserId": "usr_xxx",
  "note": "CSV memo"
}
```

备注验证：

```http
GET /users/{uid}
```

屏蔽玩家：

```http
POST /auth/user/playermoderations
Content-Type: application/json

{
  "moderated": "usr_xxx",
  "type": "block"
}
```

屏蔽验证：

```http
GET /auth/user/playermoderations
```

## CSV

CSV 只接受两列语义：

```csv
uid,memo
usr_00000000-0000-4000-8000-000000000001,备注文本
```

实现规则：

- UTF-8。
- 表头必须包含 `uid` 和 `memo`。
- 多余列先忽略。
- `uid` 必须匹配完整 VRChat 用户 ID。
- `memo` 非空，默认不超过 256 字符。
- 重复 UID 标记为错误，由用户在编辑页处理。
- `memo` 的业务格式不属于工具，工具只把它当作最终 note 文本。

## 状态语义

单条结果状态：

- `success`：备注覆盖成功且 block 验证成功。
- `already_blocked`：备注覆盖成功，且执行前或执行后验证到已经 block。
- `failed_block_after_note`：备注已写入，但 block 未验证通过。
- `failed_note_after_block`：保留状态；正常顺序下很少出现，因为先写备注再 block。
- `failed`：校验、登录、网络或不可恢复 API 错误。
- `skipped`：用户跳过，未调用 API。
