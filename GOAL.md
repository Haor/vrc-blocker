# Goal Loop

## Goal

把当前 `vrc-blocker` 从“已初始化 Tauri/Rust 骨架 + 已按 UI prototype 适配运行版前端”的状态推进到完整可执行、可运行、可验收的独立 VRChat 屏蔽工具。

完成状态定义：

- Windows、macOS、Linux 至少能在 GitHub Actions 产出可下载构建产物。
- macOS 本机能运行 debug build。
- 运行版前端的所有关键入口都接到真实 Tauri commands，不再依赖 mock `setTimeout` 数据。
- 能用 VRChat 登录或本机 VRCX Cookie 建立会话。
- 能导入 `uid,memo` CSV，编辑/跳过条目，确认后执行屏蔽并覆盖写入在线 `userNotes`。
- 能处理已屏蔽玩家：仍覆盖备注，block 验证通过后记为 `already_blocked`。
- 能导出 JSON 报告和失败 CSV。
- 有一套受控 live smoke test：只选 1-2 个测试 UID，不全量执行真实名单。

## Loop

每轮都按同一循环推进，直到 Exit Criteria 全部满足。

1. **Plan**
   - 选一个最小可验收切片。
   - 明确本轮涉及的 UI、command、后端模块、测试证据。
   - 不扩大到无关重构。

2. **Implement**
   - 前端只调用 Tauri command 或订阅 Tauri event。
   - VRChat API 只在 Rust `vrchat` 模块内封装。
   - 执行队列只在 `run_engine` 内管理。
   - Cookie、报告、临时 CSV 不写入 git 可跟踪路径。

3. **Verify Locally**
   - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
   - `cargo tauri build --debug --no-bundle`
   - 必要时启动本机 app 做手动 UI 检查。

4. **Live Smoke When Needed**
   - 从本机 VRCX Cookie 读取 VRChat 会话，仅用于本机测试。
   - 从可用输入源临时抽 1-2 条 UID 到 `local-test/*.csv`。
   - 先 dry-run，再运行真实 smoke。
   - 验证 `GET users/{uid}` 的 `note` 与 CSV memo 一致。
   - 验证 `GET auth/user/playermoderations` 中存在 `type=block`。
   - 记录结果到本地忽略文件；不提交真实 UID、Cookie、报告。

5. **Push and CI**
   - 提交到 GitHub。
   - GitHub Actions 必须跑过 `ci.yml`。
   - 多平台 `build.yml` 必须至少成功产出 macOS、Windows、Linux artifacts。
   - 如果 CI 失败，回到 Plan，基于失败日志修正。

6. **Review**
   - 检查 README、docs、UI 文案是否和真实行为一致。
   - 检查 `.gitignore` 是否覆盖敏感本地测试文件。
   - 检查报告里不含密码、Cookie、二步验证 token。

## Work Queue

### 1. Frontend Wiring

- 已把 prototype 拆分并适配为 `public/index.html`、`public/styles.css`、`public/app.js`。
- 已隐藏 Tauri 原生标题栏，使用自定义可拖动标题栏和窗口控制按钮。
- 已把导入按钮接文件选择和 CSV parser。
- 已把登录弹窗接 `login` / `verify_two_factor` / `logout` / `get_session_status`，但后端登录仍是 scaffold。
- 已让编辑页保留前端内存编辑，提交前生成 `StartRunRequest`。
- 已接 dry-run 报告页到 `start_block_run` scaffold。
- 执行页订阅 `run:progress`、`run:log`、`run:backoff`、`run:finished`、`run:aborted`。
- 真实网络执行接线完成后，报告页继续使用真实 `RunReport`。

### 2. VRChat Session

- 实现账号密码登录。
- 实现 TOTP 与 Email OTP。
- Cookie 写入系统钥匙串或 app data 私有文件。
- 实现仅本机测试用的 VRCX Cookie 导入/复用路径，默认不暴露给普通 UI。
- 会话失效时发 `session:changed` 并暂停运行。

### 3. Import and Manifest

- 完成文件对话框、导出示例 CSV。
- 实现 manifest 保存、读取、删除。
- 保持导入格式只含 `uid,memo`。
- 不在工具内生成或解释 memo 业务格式。

### 4. Run Engine

- 单账号串行执行。
- 每条顺序：覆盖 note -> `GET users/{uid}` 验 note -> block 或 already blocked -> 验 block。
- 429 使用 `Retry-After`，否则指数退避，默认最多 5 次。
- 5xx/网络临时错误退避重试。
- 401/403 停止整批并要求重新登录。
- 支持暂停、继续、停止、重试失败。

### 5. Report and History

- JSON report 使用 `vrc-blocker.report.v1`。
- 失败 CSV 只导出失败 UID 和 memo。
- 历史页能重新打开本地报告。
- 报告不包含敏感 token 或 Cookie。

### 6. GitHub Delivery

- 私有 GitHub repo 保存源码。
- `ci.yml` 跑格式、测试。
- `build.yml` 构建 macOS arm64/x64、Windows、Linux。
- artifacts 上传到 Actions。
- 后续需要公开分发时再补签名、公证和 release 发布策略。

## Exit Criteria

- `main` 分支 CI 通过。
- `build` workflow 至少有一轮完整成功。
- 本机 app 能打开迁入的 UI。
- 本机 dry-run 能从示例 CSV 生成报告。
- 本机 live smoke 用 1-2 个 UID 验证 note 覆盖和 block 生效。
- 已屏蔽 UID 的 smoke 路径能返回 `already_blocked` 或等价成功状态。
- README 的运行方式、CSV 格式、安全边界与实际行为一致。
- 没有真实 Cookie、VRCX 数据库、真实批量报告或完整个人名单进入 git。
