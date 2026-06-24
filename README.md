# VRC Blocker

独立的 VRChat 批量屏蔽小工具。它导入 `uid,memo` CSV，执行 VRChat player moderation `block`，并把 `memo` 覆盖写入对应玩家的在线 `userNotes`。

这个项目不依赖 VRCX 数据库，也不读取当前目录里的真实名单文件。真实名单只是可选输入源。

## 技术栈

- Tauri v2
- Rust 后端：登录、Cookie、VRChat API、CSV、执行队列、退避、报告
- 静态 HTML/CSS/JS 前端：无 React、无 Vite、无运行期 Node 依赖

最终用户只需要运行打包出的桌面程序。开发时需要 Rust/Tauri CLI；本机已经可以用 `cargo tauri`。

## 当前骨架

- `public/index.html`：从当前 UI prototype 迁入的单文件静态界面。
- `src-tauri/src/commands/`：前端可调用的 Tauri commands。
- `src-tauri/src/vrchat/`：VRChat API client 边界。
- `src-tauri/src/import/`：CSV 解析与校验。
- `src-tauri/src/run_engine/`：执行报告与退避策略入口。
- `docs/`：后端契约、报告 JSON、限速退避说明。
- `examples/example.csv`：脱敏示例 CSV。
- `.github/workflows/`：跨平台测试和多平台 Tauri 构建。

## 开发命令

```bash
cargo tauri dev
cargo tauri build
```

Rust 单元测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

本地 Tauri debug build：

```bash
cargo tauri build --debug --no-bundle
```

## CSV 格式

```csv
uid,memo
usr_00000000-0000-4000-8000-000000000001,风险等级：高；类别：示例；名称：示例用户A；来源：示例名单；原因：示例原因；备注：演示数据
```

`memo` 是最终写入 VRChat 在线 `userNotes` 的文本。工具只校验长度和可写性，不理解备注语义，不生成备注格式。

## 安全边界

- 不提交真实名单、VRCX 数据库、Cookie、报告或本地测试 CSV。
- 线上 smoke test 使用本机 VRCX Cookie 时，只从真实名单中临时选 1-2 条写入 `local-test/`，该目录被 git 忽略。
- 批量真实屏蔽必须经过确认页；默认开发路径先 dry-run。
