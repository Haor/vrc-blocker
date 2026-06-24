# vrc-blocker · 前端原型说明（README）

> 本文件描述 `docs/ui-prototype.html` 这个交互原型的**所有板块**、**操作逻辑**、**交互逻辑**，以及每个板块**后端需要实现什么、提供什么**。
> 需求源文档见 [`online-usernotes-tool-requirements.md`](./online-usernotes-tool-requirements.md)，本 README 在其基础上按当前原型形态收敛。

---

## 1. 工具定位

vrc-blocker 是一个和 VRCX 脱钩的桌面小工具，用 VRChat 官方 API 批量**屏蔽**导入名单里的玩家，并把对应原因覆盖写入玩家的**线上备注 `userNotes`**。

- 它**做**：登录账号 → 导入名单（`uid,memo`）→ 逐条编辑/跳过 → 串行批量覆盖 `userNotes` → 调用官方 Block → 输出执行报告。
- 它**不做**：读写 VRCX 本地库、管理好友/世界/Avatar、扩散公开名单。

口径统一：界面和技术实现都以「**屏蔽**」为主动作；写入线上备注是屏蔽时的附带说明。

---

## 2. 预览方式

原型是单文件、零依赖的静态页面，直接用浏览器打开即可：

```bash
open docs/ui-prototype.html      # macOS
```

所有数据均为前端 mock，按钮调用的是占位逻辑（toast / setTimeout）。本 README 标注每个交互在**真实实现**中应替换为哪个后端命令或事件。

---

## 3. 技术栈与架构

| 层 | 选型 | 职责 |
|----|------|------|
| 桌面壳 | Tauri v2 | 窗口、文件对话框、系统钥匙串、打开目录 |
| 后端 | Rust | 登录/2FA、HTTP、Cookie、CSV 解析校验、批量屏蔽、备注覆盖、限速退避、报告导出 |
| 前端 | 静态 HTML/CSS/JavaScript | 页面状态与交互，仅调用应用命令，不直接拼 API 请求 |

调用约定：

- **命令（请求/响应）**：前端 `invoke("command", args)` → Rust `#[tauri::command]`。
- **事件（后端推送）**：执行进度等实时流用 Tauri event，后端 `emit`，前端 `listen`。
- 前端不持有任何 VRChat URL / Cookie / Basic Auth 细节，全部在 Rust 端封装。

---

## 4. 核心数据模型（前后端共享 TS 视角）

```ts
// 一条待写入记录
type ImportRow = {
  rowIndex: number;
  uid: string;                 // 完整 usr_...
  memo: string;                // 原始备注
  normalizedMemo: string;      // 提交前归一（去换行）
  skip: boolean;               // 是否跳过（默认 false = 屏蔽）
  validation: ValidationIssue[];
  status: "pending" | "skipped" | "writing" | "success" | "failed";
  hasExistingNote?: boolean;   // 线上是否已有备注（用于覆盖提示）
  error?: string;
};

type ValidationIssue = {
  rowIndex: number;
  uid?: string;
  kind: "invalid_uid" | "empty_memo" | "too_long" | "duplicate";
  message: string;
  suggestion?: string;
};

// 一份名单（manifest）
type Manifest = {
  id: string;
  name: string;                // 文件名
  count: number;               // 有效条数
  importedAt: string;
  status: "ready" | "done";
  ok?: number;
  bad?: number;
  rows: ImportRow[];
};

type AccountSession = {
  accountId: string;
  userId: string;              // usr_...
  displayName: string;
  sessionState: "unknown" | "valid" | "requires2fa" | "invalid";
  lastValidatedAt?: string;
};

// 单条写入结果
type WriteResult = {
  uid: string;
  status: "success" | "failed" | "skipped";
  httpStatus?: number;
  message?: string;
  writtenAt?: string;
};

// 执行报告
type RunReport = {
  manifestName: string;
  account: { displayName: string; userId: string };
  startedAt: string;
  finishedAt: string;
  total: number; ok: number; bad: number; skip: number;
  results: WriteResult[];
};

type HistoryEntry = {
  id: string;
  time: string;
  account: string;
  total: number; ok: number; bad: number; skip: number;
  reportPath?: string;         // 落盘的 report.json
};
```

---

## 5. 各板块功能 / 交互 / 后端要求

### 5.1 窗口外壳与账号区（左上角）

**界面**：macOS 风格窗口（标题栏 + 侧边栏 + 主区）。侧边栏顶部是账号卡，导航为「名单 / 历史」。

**两种账号状态**：
- 未登录：账号卡显示虚线「+ 登录 VRChat」按钮。
- 已登录：显示显示名 + UID + 状态圆点（绿=已登录 / 金=写入中或需 2FA / 灰=未登录），名字行右侧有**登出**图标按钮。

**交互逻辑**：
- 点账号卡的「登录」→ 打开登录浮窗（见 5.2）。
- 点登出图标 → 调 `logout()`，账号卡切回未登录态。
- 状态圆点随会话/执行状态变化。

**后端需要提供**：
- `refresh_session() -> AccountSession`：启动时与定时校验当前会话是否有效，驱动圆点与登录态。
- `logout() -> void`：清除本地会话（删 Cookie / keyring 项）。
- `get_current_account() -> AccountSession | null`：渲染账号卡。

**侧边栏底部**：仅保留「语言」入口（打开语言浮窗，见 5.9）和版本号。原「帮助 / 关于」已移除。

---

### 5.2 登录浮窗（凭据 + 两步验证）

**界面**：居中浮窗，分两步，标题随步骤切换（「登录 VRChat」/「两步验证」）。可点遮罩、按 Esc、点取消关闭。

**步骤 1 · 凭据**：用户名或邮箱 + 密码，底部一行状态提示（待输入 / 登录中… / 错误信息）。
**步骤 2 · 两步验证**（参考 AvatarBatchPublisher 设计）：一句提示 + **单个 6 位验证码输入框**（数字、`maxLength=6`），左按钮变「返回」（回到步骤 1），右按钮变「提交验证」。

**交互逻辑**：
1. 提交凭据 → `login()`。
2. 若返回需要 2FA → 切到步骤 2，记住 `challengeId`。
3. 提交验证码 → `verify_two_factor()` → 成功则关闭浮窗、账号卡转已登录、toast「会话已建立」。
4. 「返回」回到凭据步；失败时在状态行/错误条展示原因。

**后端需要提供**：
```ts
login(userNameOrEmail: string, password: string): Promise<
  | { status: "completed"; account: AccountSession }
  | { status: "requires_totp" | "requires_email_otp"; challengeId: string; message?: string }
  | { status: "failed"; error: string }
>;

verify_two_factor(challengeId: string, code: string): Promise<
  | { status: "completed"; account: AccountSession }
  | { status: "failed"; error: string }
>;

cancel_login(challengeId: string): Promise<void>; // 返回上一步时撤销挑战
```

**后端职责**：`GET auth/user` + Basic Auth；识别 `requiresTwoFactorAuth`；TOTP `auth/twofactorauth/totp/verify`、Email OTP `auth/twofactorauth/emailotp/verify`；成功后保存 `auth`/`twoFactorAuth` Cookie 到系统钥匙串，**绝不把密码落盘**。

---

### 5.3 屏蔽名单（主工作台）

**界面**：页标题「屏蔽名单」。操作行：「导入 CSV」(主) + 「下载示例 CSV」 + 右侧名单计数。下面是名单卡片列表（图标、文件名、`N 人 · 导入于 …`、未执行/已执行徽标、进入箭头）。

**功能点**：
- 导入 CSV：选文件 → 解析 → 校验 → 生成一份名单。
- 下载示例 CSV：导出标准模板 `vrc_block_list_example.csv`（表头 `uid,memo` + 一行示例）。
- 名单管理：列出所有已导入名单，点击进入详情。

**交互逻辑**：
- 点「导入 CSV」→ `pick_import_file()` 取路径 → `parse_import_file()` 解析 → `validate_rows()` 校验 → 新增 Manifest 卡片，徽标「未执行」。
- 点「下载示例 CSV」→ `export_template()`。
- 点名单卡 → 进入「名单详情 · 编辑」。

**后端需要提供**：
```ts
pick_import_file(): Promise<string | null>;            // 文件对话框
parse_import_file(path: string): Promise<{ rows: ImportRow[]; meta: ParseMeta }>;
validate_rows(rows: ImportRow[]): Promise<{ rows: ImportRow[]; summary: ValidationSummary }>;
export_template(path?: string): Promise<string>;       // 返回写出的路径
list_manifests(): Promise<Manifest[]>;                  // 持久化的名单列表（可选）
```

```ts
type ParseMeta = { encoding: string; totalRows: number };
type ValidationSummary = {
  total: number; valid: number;
  invalidUid: number; emptyMemo: number; duplicate: number; tooLong: number;
};
```

**校验规则**：UTF-8；仅 `uid,memo` 两列（多余列忽略）；`uid` 必须合法 `usr_...`；`memo` 非空、不超长（默认 256）；重复 `uid` 去重。导入后把忽略统计回传，前端可在详情页提示。

---

### 5.4 名单详情 · 编辑

**界面**：返回名单按钮 + 名单文件名标题。左右两栏：
- 左：搜索框 + 条目列表（每条显示 UID 缩写、备注摘要；跳过项灰置并加「跳过」标签）。
- 右：选中条目的完整 UID、备注文本域（带 `当前/256` 计数）、「跳过 / 恢复写入」按钮、提示「备注将写入 VRChat 线上备注，跟随账号同步」。
- 底部：`N 人将屏蔽 · M 跳过` + 「执行屏蔽 →」。

**操作逻辑（刻意精简）**：导入后**默认全部屏蔽**，用户每条只能做两件事——**改备注**或**跳过**。无"待写入/启用"等多余状态。

**交互逻辑**：
- 选中条目 → 右侧载入；编辑文本域 → 实时回写该行 `memo` 与列表摘要、刷新计数（超 256 标红）。
- 「跳过/恢复」→ 翻转该行 `skip`，刷新底部统计与列表灰置。
- 搜索 → 按 UID/备注过滤列表。
- 「执行屏蔽」→ 进入执行确认。

**后端需要提供**：
- 编辑发生在前端内存中的 `Manifest.rows`，无需逐字段命令。
- 可选 `save_manifest(manifest)` 持久化编辑结果，便于关闭后恢复。
- `preview_write(rows)`：进入确认前调用，读取线上现有备注，返回每条 `hasExistingNote`，用于覆盖提示与计数。
- 备注长度上限来自 `get_settings().memoMaxLength`（默认 256）。

---

### 5.5 名单详情 · 执行确认

**界面**：说明「单账号串行执行。正常请求不做秒级固定等待；429/5xx 按 Retry-After 或指数退避，401/403 立即停止。」概要表：账号、将屏蔽 `N 人`、API `POST /api/1/userNotes` + `POST /api/1/auth/user/playermoderations`。**红字**确认勾选框「我确认屏蔽以上账号，并覆盖写入线上备注。」勾选后「开始屏蔽」可点。

**交互逻辑**：
- 进入时调 `preview_write()` 得到将写入条数（排除跳过）。
- 必须勾选确认框才能开始（防误操作）。
- 「返回编辑」回到 5.4；「开始屏蔽」→ 进入执行中。

**后端需要提供**：
```ts
preview_write(rows: ImportRow[]): Promise<{
  willWrite: number;          // 不含 skip
  willSkip: number;
  existingNotes: number;      // 会覆盖的条数（可用于风控提示）
}>;
```

---

### 5.6 名单详情 · 执行中（进度 + 时间线日志）

**界面**：
- 进度条 `done / total` + 实时百分比。
- 四张统计卡：成功 / 失败 / 跳过 / 剩余。
- 限速提示条：`429 退避中 · 等待 Ns 后自动继续（重试 x/3）`。
- **活动时间线日志**：每行 `时间 · 阶段药丸 · UID · 详情`，阶段含 START / WRITTEN / OVERWRITE / BACKOFF / FAILED / DONE。
- 控制按钮：暂停/继续、停止；完成后出现「重试失败」「返回名单」「查看报告」。

**写入策略（后端核心）**：
- **单账号串行**，正常成功请求不做秒级固定等待，只加小抖动避免机械间隔。
- 每条：`POST userNotes` 提交，再 `GET users/{uid}` 读回 `note` 字段确认（不能只信 POST 响应体），然后执行/验证 `block`。
- 已有备注始终用导入 CSV 的 `memo` **直接覆盖**，没有其他策略。
- `429 / 5xx` → 按 `Retry-After` 或指数退避重试，默认最多 5 次。
- `401 / 403` → **立即停止整批**并要求重新登录。
- 多行备注会被服务端归一为空格，UI 只做最终预览提示。

**交互逻辑**：前端订阅后端事件流刷新进度/日志，按钮调用控制命令。

**后端需要提供（命令 + 事件）**：
```ts
// 命令
start_block_run(rows: ImportRow[], options: RunOptions): Promise<RunReport>;
pause_run(): Promise<void>;
resume_run(): Promise<void>;
stop_run(): Promise<void>;
retry_failed(results: WriteResult[]): Promise<RunReport>;

type RunOptions = {
  normalJitterMs: [number, number]; // 默认 [150, 350]
  maxRetries: number;               // 默认 5
  memoMaxLength: number;            // 默认 256
};
```

```ts
// 事件（后端 emit，前端 listen）
"run:progress"  -> { done: number; total: number; ok: number; bad: number; skip: number }
"run:log"       -> { ts: string; stage: "start"|"written"|"overwrite"|"backoff"|"failed"|"done"|"info";
                     uid?: string; httpStatus?: number; message: string }
"run:backoff"   -> { waitSeconds: number; retry: number; maxRetries: number }
"run:finished"  -> RunReport
"run:aborted"   -> { reason: "stopped" | "auth_required"; message: string }
```

---

### 5.7 执行报告

**界面**：标题「执行报告」。概要卡（名单、账号、时间、API）。统计卡：成功 / 失败 / 跳过 / 总计。结果表：UID、状态（彩色药丸）、HTTP、详情。底部：「导出失败 CSV」「返回名单」「导出 JSON」。

**进入路径**：执行完成后点「查看报告」；或在历史页点某行「报告」。两者复用同一渲染。

**交互逻辑**：
- 导出 JSON → 落盘完整 `RunReport`。
- 导出失败 CSV → 仅失败条目，方便修正后重导。
- 返回名单 → 回到 5.3。

**后端需要提供**：
```ts
export_report(report: RunReport, path?: string): Promise<string>;   // 写 report.json，返回路径
export_failed_csv(results: WriteResult[], path?: string): Promise<string>;
get_report(id: string): Promise<RunReport>;                          // 历史回看时按 id 读盘
```

---

### 5.8 历史

**界面**：累计统计卡（总批次 / 累计成功 / 失败 / 跳过）+ 历史表（时间、账号、写入、成功、失败、跳过、报告）。

**交互逻辑**：
- 点某行「报告」→ 打开 5.7 执行报告页（用该批次数据填充），**不是**直接弹 JSON。
- 历史不含敏感数据（无 Cookie、无密码）。

**后端需要提供**：
```ts
list_history(): Promise<HistoryEntry[]>;
get_history_stats(): Promise<{ batches: number; ok: number; bad: number; skip: number }>;
// 点击报告时：get_report(entry.id) -> RunReport
```

---

### 5.9 语言（浮窗）

**界面**：侧边栏底部「语言」打开的小浮窗，单一功能——界面语言切换，分段控件「中文 / 日本語 / English」，点遮罩或 Esc 关闭。

**交互逻辑**：选中语言 → 高亮当前项 → toast 提示已切换。原型内为前端 mock，不落盘。

**后端需要提供**：
- `get_settings() -> { locale: string }` / `save_settings({ locale })`：持久化界面语言（可选，原型暂为前端状态）。

> 原「帮助 / 关于」浮窗已删除，工具说明并入本 README。

---

## 6. 后端能力汇总

### 6.1 命令（invoke）

| 分组 | 命令 |
|------|------|
| 认证 | `login` · `verify_two_factor` · `cancel_login` · `refresh_session` · `logout` · `get_current_account` |
| 导入 | `pick_import_file` · `parse_import_file` · `validate_rows` · `export_template` · `list_manifests` · `save_manifest`(可选) |
| 写入 | `preview_write` · `start_block_run` · `pause_run` · `resume_run` · `stop_run` · `retry_failed` |
| 报告/历史 | `export_report` · `export_failed_csv` · `get_report` · `list_history` · `get_history_stats` |
| 设置 | `get_settings` · `save_settings`（当前仅界面语言：中 / 日 / 英） |

### 6.2 事件（emit）

`run:progress` · `run:log` · `run:backoff` · `run:finished` · `run:aborted` · `session:changed`（会话失效时通知前端切登录态）。

---

## 7. 写入策略与风控（必须实现）

- 提交前确认弹窗（5.5）。
- 明确提示会调用 VRChat block，并写入线上 `userNotes`。
- 单账号串行 + 请求间隔 + 退避重试，不无限重试。
- `401/403` 立即停止整批并要求重新登录（`run:aborted` reason=`auth_required`）。
- 已有备注：确认页显示覆盖提示；执行时始终覆盖，不提供覆盖/跳过/追加策略。
- 失败可重试、可导出失败 CSV。

---

## 8. 安全

- 不保存密码到磁盘。
- Cookie 优先存系统钥匙串（keyring）；不可用时落 app data 私有文件并加显著风险提示。
- 日志/报告自动脱敏，不打印 Cookie。
- 全程使用明确 User-Agent（如 `vrc-blocker/0.1.0 (author: ...)`）。

---

## 9. 设置（默认值）

| 设置项 | 默认 |
|--------|------|
| 正常请求间隔 | 仅小抖动，不做固定秒级等待 |
| 最大重试 | 5 |
| 备注长度上限 | 256 |
| 已有备注策略 | 始终覆盖 |
| 日志级别 | info |

> 原型未提供独立"设置页"，上述写入相关设置内置默认值；侧边栏「语言」浮窗仅做界面语言切换（中 / 日 / 英）。

---

## 10. 与原型的差异 / 待办

- 原型数据全为 mock，所有 toast/`setTimeout` 需替换为真实命令与事件订阅。
- 名单持久化（`save_manifest`/`list_manifests`）当前未在 UI 体现，按需接入。
- 网络代理模式、Email OTP 分支在原型中简化，后端仍需完整支持（见需求文档）。
