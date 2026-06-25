/* =========================================================================
   vrc-blocker — 前端逻辑
   UI 结构来自 docs/ui-prototype.html，后端对接沿用原 Tauri 命令。
   单页流程：名单(import) → 名单详情(manifest: 编辑/确认/执行时间线) → 报告(report)
   ========================================================================= */
const MEMO_LIMIT = 256;
const LANG_KEY = "vrc-blocker.lang";
const MANIFESTS_KEY = "vrc-blocker.manifests.v1";
const HISTORY_KEY = "vrc-blocker.history.v1";
const MANIFESTS_LIMIT = 100;
const HISTORY_LIMIT = 50;
const RUN_PROGRESS_EVENT = "vrc-blocker-run-progress";

const tauriApi = window.__TAURI__;
const invoke = tauriApi?.core?.invoke;
const listen = tauriApi?.event?.listen;
const currentWindow = tauriApi?.window?.getCurrentWindow?.();

const state = {
  lang: normalizeLang(localStorage.getItem(LANG_KEY)),
  session: null,
  manifests: loadManifests(),
  activeManifestId: null,
  selectedRowIndex: 0,
  search: "",
  report: null,
  reportManifestName: null,
  reportAccountLabel: null,
  reportNavOrigin: "import",
  reportTime: null,
  history: loadHistory(),
  pendingChallenge: null,
  toastTimer: null,
  runTimer: null,
  runInFlight: false,
  runProgress: null,
  runProgressUnlisten: null,
};

const I18N = {
  zh: {
    "window.close": "关闭窗口",
    "window.minimize": "最小化窗口",
    "window.maximize": "最大化窗口",
    "session.unverified": "会话未验证",
    "session.waiting": "等待登录",
    "session.valid": "会话可用",
    "session.requiresTwoFactor": "等待二步验证",
    "session.invalid": "会话无效",
    "session.noAccount": "未登录账号",
    "session.logoutTitle": "登出账号",
    "session.loggedOut": "已登出，本地会话已清除",
    "nav.workspace": "工作区",
    "nav.manifests": "名单",
    "nav.history": "历史",
    "nav.language": "语言",
    "import.title": "屏蔽名单",
    "import.lead": "导入并管理你的屏蔽名单（<span class=\"hl\">uid,备注</span> 两列）。点开名单可编辑备注、执行屏蔽并查看报告。",
    "import.example": "下载示例 CSV",
    "import.csv": "导入 CSV",
    "import.noRows": "还没有导入 CSV。点击右上角\"导入 CSV\"开始。",
    "import.all": "全部名单",
    "import.count": "{count} 份",
    "import.imported": "已导入 {count} 条",
    "import.exampleDone": "示例 CSV 已生成",
    "stats.manifests": "名单",
    "stats.pending": "待执行",
    "stats.blocked": "累计屏蔽",
    "manifest.back": "← 名单",
    "manifest.none": "未选择名单",
    "manifest.search": "搜索 UID / 备注…",
    "manifest.pick": "选择一个名单开始编辑",
    "manifest.skip": "跳过",
    "manifest.restore": "恢复写入",
    "manifest.memo": "备注 (memo)",
    "manifest.noteInfo": "备注将写入 <span class=\"hl\">VRChat 线上备注</span>，跟随账号同步。",
    "manifest.summary": "{write} 人将屏蔽 · {skip} 跳过",
    "manifest.execute": "执行屏蔽 <span class=\"k\">→</span>",
    "manifest.noMatch": "没有匹配条目",
    "manifest.emptyMemo": "空备注",
    "manifest.skippedTag": "跳过",
    "manifest.needsFix": "需修正",
    "manifest.noExecutable": "没有可执行的名单",
    "manifest.invalidRows": "还有 {count} 条未通过校验",
    "manifest.noWritable": "没有需要执行的条目",
    "manifest.loginFirst": "请先登录 VRChat",
    "manifest.stillInvalid": "仍有条目未通过校验",
    "manifest.listMeta": "{count} 人 · 导入于 {date}",
    "manifest.doneBadge": "已执行 {success}/{total}",
    "manifest.fixBadge": "{count} 条需修正",
    "manifest.readyBadge": "未执行",
    "manifest.delete": "删除名单",
    "manifest.deleteConfirm": "删除名单「{name}」？此操作不可撤销。",
    "manifest.deleted": "已删除名单「{name}」",
    "confirm.lead": "单账号串行执行。正常请求只加小抖动；429/5xx 按 Retry-After 或指数退避，<b>401/403 立即停止</b>。",
    "confirm.account": "账号",
    "confirm.toBlock": "将屏蔽",
    "confirm.peopleSuffix": " 人",
    "confirm.checkbox": "我确认屏蔽以上账号，并覆盖写入线上备注。",
    "confirm.skipFriends": "跳过列表中的好友（推荐）",
    "confirm.skipFriendsHint": "开启后，如果名单中有你的好友，将自动跳过并在报告中标记。",
    "confirm.back": "← 返回编辑",
    "confirm.start": "开始屏蔽 <span class=\"k\">↵</span>",
    "confirm.running": "执行中…",
    "run.idle": "屏蔽中…实时显示每条备注写入与 block 执行进度。",
    "run.active": "屏蔽中…后端正在逐条覆盖备注并执行 block。",
    "run.progress": "执行进度",
    "run.success": "成功",
    "run.failed": "失败",
    "run.skipped": "跳过",
    "run.remaining": "剩余",
    "run.back": "返回名单",
    "run.report": "查看报告 <span class=\"k\">→</span>",
    "run.submitting": "已提交 · 后端正在执行，请等待结果",
    "run.startLog": "开始执行 · 计划屏蔽 {total} 人 · POST /api/1/userNotes + POST /api/1/auth/user/playermoderations",
    "run.doneLead": "执行完成 · 成功 {success} · 失败 {failed}{skipped}",
    "run.doneLog": "全部完成 · 成功 {success} 失败 {failed}",
    "run.skippedPart": " · 跳过 {skipped}",
    "run.metaSuccess": "写入 + 屏蔽",
    "run.metaAlready": "已屏蔽 · 覆盖备注",
    "run.metaSkipped": "手动跳过",
    "run.metaSkippedFriend": "好友 · 已跳过",
    "run.metaFailed": "失败",
    "run.noteUnverified": "备注未验证，已继续屏蔽",
    "report.title": "执行报告",
    "report.lead": "本次屏蔽执行的完整结果。可导出 JSON 存档，或追溯失败条目重试。",
    "report.manifest": "名单",
    "report.account": "账号",
    "report.time": "时间",
    "report.status": "状态",
    "report.detail": "详情",
    "report.total": "总计",
    "report.exportFailed": "导出失败 CSV",
    "report.back": "返回名单",
    "report.exportJson": "导出 JSON",
    "report.none": "暂无报告",
    "report.noneExport": "暂无报告可导出",
    "report.noFailed": "没有失败条目",
    "report.jsonDone": "报告 JSON 已导出",
    "report.failedCsvDone": "失败 CSV 已导出",
    "report.copied": "已复制",
    "status.success": "成功",
    "status.failed": "失败",
    "status.skipped": "跳过",
    "status.alreadyBlocked": "已屏蔽",
    "status.skippedFriend": "好友跳过",
    "status.failedBlockAfterNote": "备注后屏蔽失败",
    "status.failedNoteAfterBlock": "屏蔽后备注失败",
    "history.title": "历史",
    "history.lead": "执行记录，可重新打开报告或导出失败 CSV。",
    "history.empty": "暂无本地历史",
    "history.count": "{count} 条",
    "history.records": "执行记录",
    "history.itemMeta": "{success} 成功 · {failed} 失败 · {skipped} 跳过",
    "login.title": "登录 VRChat",
    "login.user": "用户名或邮箱",
    "login.password": "密码",
    "login.passwordPlaceholder": "password",
    "login.twoFactorTitle": "两步验证",
    "login.twoFactorPrompt": "需要两步验证。请输入验证器 App 生成的 6 位 TOTP 验证码。",
    "login.code": "验证码",
    "login.initial": "",
    "login.cancel": "取消",
    "login.back": "返回",
    "login.submit": "登录 <span class=\"k\">↵</span>",
    "login.submit2fa": "提交验证 <span class=\"k\">↵</span>",
    "login.missingCredentials": "请填写用户名和密码",
    "login.inProgress": "登录中…",
    "login.missingChallenge": "缺少二步验证 challenge",
    "login.verifying": "验证中…",
    "login.success": "登录成功",
    "login.established": "会话已建立",
    "login.needAuthenticator": "需要验证器 App 中的验证码",
    "login.failed": "登录失败",
    "login.showPassword": "显示密码",
    "login.hidePassword": "隐藏密码",
    "settings.title": "语言",
    "settings.interfaceLanguage": "界面语言",
    "settings.done": "完成",
    "settings.changed": "界面语言已切换为 {name}",
    "lang.zh": "中文",
    "lang.ja": "日本語",
    "lang.en": "English",
    "validation.memoRequired": "memo 不能为空",
    "validation.memoTooLong": "memo 超过 {limit} 字符",
    "error.tauriUnavailable": "Tauri runtime 不可用。请用桌面程序打开，不要直接用浏览器打开 HTML。",
  },
  ja: {
    "window.close": "ウィンドウを閉じる",
    "window.minimize": "最小化",
    "window.maximize": "最大化",
    "session.unverified": "セッション未確認",
    "session.waiting": "ログイン待ち",
    "session.valid": "セッション有効",
    "session.requiresTwoFactor": "2段階認証待ち",
    "session.invalid": "セッション無効",
    "session.noAccount": "未ログイン",
    "session.logoutTitle": "ログアウト",
    "session.loggedOut": "ログアウトしました。ローカルセッションを削除しました",
    "nav.workspace": "ワークスペース",
    "nav.manifests": "リスト",
    "nav.history": "履歴",
    "nav.language": "言語",
    "import.title": "ブロックリスト",
    "import.lead": "ブロックリスト（<span class=\"hl\">uid,memo</span> の2列）をインポートして管理します。リストを開くとメモ編集、ブロック実行、レポート確認ができます。",
    "import.example": "サンプル CSV",
    "import.csv": "CSV をインポート",
    "import.noRows": "CSV はまだありません。右上の「CSV をインポート」から開始してください。",
    "import.all": "すべてのリスト",
    "import.count": "{count} 件",
    "import.imported": "{count} 件をインポートしました",
    "import.exampleDone": "サンプル CSV を生成しました",
    "stats.manifests": "リスト",
    "stats.pending": "未実行",
    "stats.blocked": "累計ブロック",
    "manifest.back": "← リスト",
    "manifest.none": "リスト未選択",
    "manifest.search": "UID / メモを検索…",
    "manifest.pick": "リストを選択して編集を開始",
    "manifest.skip": "スキップ",
    "manifest.restore": "書き込みを再開",
    "manifest.memo": "メモ (memo)",
    "manifest.noteInfo": "メモは <span class=\"hl\">VRChat のオンラインメモ</span> に書き込まれ、アカウントと同期されます。",
    "manifest.summary": "{write} 人をブロック · {skip} スキップ",
    "manifest.execute": "ブロック実行 <span class=\"k\">→</span>",
    "manifest.noMatch": "一致する項目はありません",
    "manifest.emptyMemo": "空のメモ",
    "manifest.skippedTag": "スキップ",
    "manifest.needsFix": "要修正",
    "manifest.noExecutable": "実行できるリストがありません",
    "manifest.invalidRows": "{count} 件がまだ検証エラーです",
    "manifest.noWritable": "実行対象がありません",
    "manifest.loginFirst": "先に VRChat にログインしてください",
    "manifest.stillInvalid": "まだ検証エラーの項目があります",
    "manifest.listMeta": "{count} 人 · インポート日時 {date}",
    "manifest.doneBadge": "実行済み {success}/{total}",
    "manifest.fixBadge": "{count} 件要修正",
    "manifest.readyBadge": "未実行",
    "manifest.delete": "リストを削除",
    "manifest.deleteConfirm": "リスト「{name}」を削除しますか？この操作は取り消せません。",
    "manifest.deleted": "リスト「{name}」を削除しました",
    "confirm.lead": "単一アカウントで直列実行します。通常リクエストは小さな揺らぎのみ、429/5xx は Retry-After または指数バックオフ、<b>401/403 は即停止</b>します。",
    "confirm.account": "アカウント",
    "confirm.toBlock": "ブロック対象",
    "confirm.peopleSuffix": " 人",
    "confirm.checkbox": "上記アカウントをブロックし、オンラインメモを上書きすることを確認します。",
    "confirm.skipFriends": "リスト内のフレンドをスキップ（推奨）",
    "confirm.skipFriendsHint": "オンにすると、リストにフレンドが含まれる場合は自動でスキップし、レポートに記録します。",
    "confirm.back": "← 編集へ戻る",
    "confirm.start": "ブロック開始 <span class=\"k\">↵</span>",
    "confirm.running": "実行中…",
    "run.idle": "ブロック中…各メモ書き込みと block 実行状況を表示します。",
    "run.active": "ブロック中…バックエンドが順番にメモを上書きし block を実行しています。",
    "run.progress": "進行状況",
    "run.success": "成功",
    "run.failed": "失敗",
    "run.skipped": "スキップ",
    "run.remaining": "残り",
    "run.back": "リストへ戻る",
    "run.report": "レポートを見る <span class=\"k\">→</span>",
    "run.submitting": "送信済み · バックエンドで実行中です。お待ちください",
    "run.startLog": "実行開始 · ブロック予定 {total} 人 · POST /api/1/userNotes + POST /api/1/auth/user/playermoderations",
    "run.doneLead": "実行完了 · 成功 {success} · 失敗 {failed}{skipped}",
    "run.doneLog": "完了 · 成功 {success} 失敗 {failed}",
    "run.skippedPart": " · スキップ {skipped}",
    "run.metaSuccess": "書き込み + ブロック",
    "run.metaAlready": "ブロック済み · メモ上書き",
    "run.metaSkipped": "手動スキップ",
    "run.metaSkippedFriend": "フレンド · スキップ済み",
    "run.metaFailed": "失敗",
    "run.noteUnverified": "メモ未確認、ブロックは続行済み",
    "report.title": "実行レポート",
    "report.lead": "今回のブロック実行結果です。JSON 保存または失敗項目の再確認に使えます。",
    "report.manifest": "リスト",
    "report.account": "アカウント",
    "report.time": "時刻",
    "report.status": "状態",
    "report.detail": "詳細",
    "report.total": "合計",
    "report.exportFailed": "失敗 CSV を出力",
    "report.back": "リストへ戻る",
    "report.exportJson": "JSON を出力",
    "report.none": "レポートがありません",
    "report.noneExport": "出力できるレポートがありません",
    "report.noFailed": "失敗項目はありません",
    "report.jsonDone": "レポート JSON を出力しました",
    "report.failedCsvDone": "失敗 CSV を出力しました",
    "report.copied": "コピーしました",
    "status.success": "成功",
    "status.failed": "失敗",
    "status.skipped": "スキップ",
    "status.alreadyBlocked": "ブロック済み",
    "status.skippedFriend": "フレンドをスキップ",
    "status.failedBlockAfterNote": "メモ後ブロック失敗",
    "status.failedNoteAfterBlock": "ブロック後メモ失敗",
    "history.title": "履歴",
    "history.lead": "実行履歴です。レポート再表示や失敗 CSV の出力に使います。",
    "history.empty": "ローカル履歴はありません",
    "history.count": "{count} 件",
    "history.records": "実行履歴",
    "history.itemMeta": "成功 {success} · 失敗 {failed} · スキップ {skipped}",
    "login.title": "VRChat にログイン",
    "login.user": "ユーザー名またはメール",
    "login.password": "パスワード",
    "login.passwordPlaceholder": "password",
    "login.twoFactorTitle": "2段階認証",
    "login.twoFactorPrompt": "2段階認証が必要です。認証アプリの 6 桁 TOTP コードを入力してください。",
    "login.code": "認証コード",
    "login.initial": "",
    "login.cancel": "キャンセル",
    "login.back": "戻る",
    "login.submit": "ログイン <span class=\"k\">↵</span>",
    "login.submit2fa": "認証を送信 <span class=\"k\">↵</span>",
    "login.missingCredentials": "ユーザー名とパスワードを入力してください",
    "login.inProgress": "ログイン中…",
    "login.missingChallenge": "2段階認証 challenge がありません",
    "login.verifying": "確認中…",
    "login.success": "ログイン成功",
    "login.established": "セッションを確立しました",
    "login.needAuthenticator": "認証アプリのコードが必要です",
    "login.failed": "ログイン失敗",
    "login.showPassword": "パスワードを表示",
    "login.hidePassword": "パスワードを隠す",
    "settings.title": "言語",
    "settings.interfaceLanguage": "表示言語",
    "settings.done": "完了",
    "settings.changed": "表示言語を {name} に切り替えました",
    "lang.zh": "中文",
    "lang.ja": "日本語",
    "lang.en": "English",
    "validation.memoRequired": "memo は必須です",
    "validation.memoTooLong": "memo は {limit} 文字を超えています",
    "error.tauriUnavailable": "Tauri runtime が利用できません。HTML を直接開かず、デスクトップアプリから起動してください。",
  },
  en: {
    "window.close": "Close window",
    "window.minimize": "Minimize window",
    "window.maximize": "Maximize window",
    "session.unverified": "Session not verified",
    "session.waiting": "Waiting for login",
    "session.valid": "Session valid",
    "session.requiresTwoFactor": "Waiting for 2FA",
    "session.invalid": "Session invalid",
    "session.noAccount": "Not signed in",
    "session.logoutTitle": "Log out",
    "session.loggedOut": "Signed out and cleared the local session",
    "nav.workspace": "Workspace",
    "nav.manifests": "Lists",
    "nav.history": "History",
    "nav.language": "Language",
    "import.title": "Block Lists",
    "import.lead": "Import and manage block lists with two columns: <span class=\"hl\">uid,memo</span>. Open a list to edit notes, block users, and review the report.",
    "import.example": "Download sample CSV",
    "import.csv": "Import CSV",
    "import.noRows": "No CSV imported yet. Use \"Import CSV\" in the upper right to start.",
    "import.all": "All lists",
    "import.count": "{count} lists",
    "import.imported": "Imported {count} rows",
    "import.exampleDone": "Sample CSV generated",
    "stats.manifests": "Lists",
    "stats.pending": "Pending",
    "stats.blocked": "Total blocked",
    "manifest.back": "← Lists",
    "manifest.none": "No list selected",
    "manifest.search": "Search UID / memo…",
    "manifest.pick": "Select a list to start editing",
    "manifest.skip": "Skip",
    "manifest.restore": "Restore write",
    "manifest.memo": "Memo",
    "manifest.noteInfo": "The memo will be written to <span class=\"hl\">VRChat online user notes</span> and synced with the account.",
    "manifest.summary": "{write} users to block · {skip} skipped",
    "manifest.execute": "Block users <span class=\"k\">→</span>",
    "manifest.noMatch": "No matching rows",
    "manifest.emptyMemo": "Empty memo",
    "manifest.skippedTag": "Skipped",
    "manifest.needsFix": "Needs fix",
    "manifest.noExecutable": "No runnable list",
    "manifest.invalidRows": "{count} rows still fail validation",
    "manifest.noWritable": "No rows to run",
    "manifest.loginFirst": "Sign in to VRChat first",
    "manifest.stillInvalid": "Some rows still fail validation",
    "manifest.listMeta": "{count} users · imported {date}",
    "manifest.doneBadge": "Ran {success}/{total}",
    "manifest.fixBadge": "{count} need fix",
    "manifest.readyBadge": "Not run",
    "manifest.delete": "Delete list",
    "manifest.deleteConfirm": "Delete list \"{name}\"? This cannot be undone.",
    "manifest.deleted": "Deleted list \"{name}\"",
    "confirm.lead": "Runs serially on one account. Normal requests only add small jitter; 429/5xx use Retry-After or exponential backoff, and <b>401/403 stop immediately</b>.",
    "confirm.account": "Account",
    "confirm.toBlock": "To block",
    "confirm.peopleSuffix": " users",
    "confirm.checkbox": "I confirm blocking these accounts and overwriting their online notes.",
    "confirm.skipFriends": "Skip friends in the list (recommended)",
    "confirm.skipFriendsHint": "When on, any of your friends in the list are skipped automatically and flagged in the report.",
    "confirm.back": "← Back to edit",
    "confirm.start": "Start blocking <span class=\"k\">↵</span>",
    "confirm.running": "Running…",
    "run.idle": "Blocking… showing each note write and block operation.",
    "run.active": "Blocking… the backend is overwriting notes and applying blocks one by one.",
    "run.progress": "Progress",
    "run.success": "Success",
    "run.failed": "Failed",
    "run.skipped": "Skipped",
    "run.remaining": "Remaining",
    "run.back": "Back to lists",
    "run.report": "View report <span class=\"k\">→</span>",
    "run.submitting": "Submitted · backend is running, please wait",
    "run.startLog": "Started · planned blocks {total} users · POST /api/1/userNotes + POST /api/1/auth/user/playermoderations",
    "run.doneLead": "Finished · success {success} · failed {failed}{skipped}",
    "run.doneLog": "Done · success {success} failed {failed}",
    "run.skippedPart": " · skipped {skipped}",
    "run.metaSuccess": "Write + block",
    "run.metaAlready": "Already blocked · note overwritten",
    "run.metaSkipped": "Skipped manually",
    "run.metaSkippedFriend": "Friend · skipped",
    "run.metaFailed": "Failed",
    "run.noteUnverified": "Note not verified; block continued",
    "report.title": "Run Report",
    "report.lead": "Complete result for this block run. Export JSON for records or inspect failed rows for retry.",
    "report.manifest": "List",
    "report.account": "Account",
    "report.time": "Time",
    "report.status": "Status",
    "report.detail": "Detail",
    "report.total": "Total",
    "report.exportFailed": "Export failed CSV",
    "report.back": "Back to lists",
    "report.exportJson": "Export JSON",
    "report.none": "No report",
    "report.noneExport": "No report to export",
    "report.noFailed": "No failed rows",
    "report.jsonDone": "Report JSON exported",
    "report.failedCsvDone": "Failed CSV exported",
    "report.copied": "Copied",
    "status.success": "Success",
    "status.failed": "Failed",
    "status.skipped": "Skipped",
    "status.alreadyBlocked": "Already blocked",
    "status.skippedFriend": "Friend skipped",
    "status.failedBlockAfterNote": "Block failed after note",
    "status.failedNoteAfterBlock": "Note failed after block",
    "history.title": "History",
    "history.lead": "Run history can reopen reports or export failed CSVs.",
    "history.empty": "No local history",
    "history.count": "{count} records",
    "history.records": "Run history",
    "history.itemMeta": "{success} success · {failed} failed · {skipped} skipped",
    "login.title": "Sign in to VRChat",
    "login.user": "Username or email",
    "login.password": "Password",
    "login.passwordPlaceholder": "password",
    "login.twoFactorTitle": "Two-factor verification",
    "login.twoFactorPrompt": "Two-factor verification is required. Enter the 6-digit TOTP code from your authenticator app.",
    "login.code": "Code",
    "login.initial": "",
    "login.cancel": "Cancel",
    "login.back": "Back",
    "login.submit": "Sign in <span class=\"k\">↵</span>",
    "login.submit2fa": "Submit code <span class=\"k\">↵</span>",
    "login.missingCredentials": "Enter username and password",
    "login.inProgress": "Signing in…",
    "login.missingChallenge": "Missing 2FA challenge",
    "login.verifying": "Verifying…",
    "login.success": "Signed in",
    "login.established": "Session established",
    "login.needAuthenticator": "Authenticator app code required",
    "login.failed": "Sign-in failed",
    "login.showPassword": "Show password",
    "login.hidePassword": "Hide password",
    "settings.title": "Language",
    "settings.interfaceLanguage": "Interface language",
    "settings.done": "Done",
    "settings.changed": "Interface language changed to {name}",
    "lang.zh": "中文",
    "lang.ja": "日本語",
    "lang.en": "English",
    "validation.memoRequired": "memo is required",
    "validation.memoTooLong": "memo exceeds {limit} characters",
    "error.tauriUnavailable": "Tauri runtime is unavailable. Open this from the desktop app, not directly in a browser.",
  },
};

const STATIC_I18N = [
  ["#windowCloseButton", "aria-label", "window.close"],
  ["#windowMinimizeButton", "aria-label", "window.minimize"],
  ["#windowMaximizeButton", "aria-label", "window.maximize"],
  ["#winWindowCloseButton", "aria-label", "window.close"],
  ["#winWindowMinimizeButton", "aria-label", "window.minimize"],
  ["#winWindowMaximizeButton", "aria-label", "window.maximize"],
  ["#logoutButton", "title", "session.logoutTitle"],
  ["#logoutButton", "aria-label", "session.logoutTitle"],
  ["#accountButton", "html", "accountButtonHtml"],
  [".side-label", "text", "nav.workspace"],
  [".nitem[data-go='import']", "html", "navImportHtml"],
  [".nitem[data-go='history']", "html", "navHistoryHtml"],
  ["#openSettings", "text", "nav.language"],
  ["#s-import h1", "text", "import.title"],
  ["#s-import .lead", "html", "import.lead"],
  ["#exampleButton", "text", "import.example"],
  ["#importButton", "text", "import.csv"],
  [".stats .stat:nth-child(1) .l", "text", "stats.manifests"],
  [".stats .stat:nth-child(2) .l", "text", "stats.pending"],
  [".stats .stat:nth-child(3) .l", "text", "stats.blocked"],
  ["#s-import .panel-title", "text", "import.all"],
  ["#backToImportButton", "text", "manifest.back"],
  ["#rowSearch", "placeholder", "manifest.search"],
  [".detail .field label", "text", "manifest.memo"],
  [".detail .note div", "html", "manifest.noteInfo"],
  ["#openConfirmButton", "html", "manifest.execute"],
  ["#mfConfirm .lead", "html", "confirm.lead"],
  ["#mfConfirm .kv dt:nth-of-type(1)", "text", "confirm.account"],
  ["#mfConfirm .kv dt:nth-of-type(2)", "text", "confirm.toBlock"],
  [".confirm-box span", "text", "confirm.checkbox"],
  ["#skipFriendsLabel", "text", "confirm.skipFriends"],
  ["#skipFriendsHint", "text", "confirm.skipFriendsHint"],
  ["#closeConfirmButton", "text", "confirm.back"],
  ["#startBtn", "html", "confirm.start"],
  ["#runLead", "text", "run.idle"],
  [".proghead .cap", "text", "run.progress"],
  ["#mfRun .stats .stat:nth-child(1) .l", "text", "run.success"],
  ["#mfRun .stats .stat:nth-child(2) .l", "text", "run.failed"],
  ["#mfRun .stats .stat:nth-child(3) .l", "text", "run.skipped"],
  ["#mfRun .stats .stat:nth-child(4) .l", "text", "run.remaining"],
  ["#backBtn", "text", "run.back"],
  ["#reportBtn", "html", "run.report"],
  ["#backToManifestButton", "text", "manifest.back"],
  ["#s-report h1", "text", "report.title"],
  ["#s-report > .lead", "text", "report.lead"],
  ["#s-report .kv dt:nth-of-type(1)", "text", "report.manifest"],
  ["#s-report .kv dt:nth-of-type(2)", "text", "report.account"],
  ["#s-report .kv dt:nth-of-type(3)", "text", "report.time"],
  ["#s-report .stats .stat:nth-child(1) .l", "text", "run.success"],
  ["#s-report .stats .stat:nth-child(2) .l", "text", "run.failed"],
  ["#s-report .stats .stat:nth-child(3) .l", "text", "run.skipped"],
  ["#s-report .stats .stat:nth-child(4) .l", "text", "report.total"],
  ["#s-report thead th:nth-child(2)", "text", "report.status"],
  ["#s-report thead th:nth-child(4)", "text", "report.detail"],
  ["#exportFailedCsvButton", "text", "report.exportFailed"],
  ["#backToListButton", "text", "report.back"],
  ["#exportJsonButton", "text", "report.exportJson"],
  ["#s-history h1", "text", "history.title"],
  ["#s-history .lead", "text", "history.lead"],
  ["#s-history .panel-title", "text", "history.records"],
  ["#loginTitle", "text", "login.title"],
  ["label[for='loginUser']", "html", "loginUserLabel"],
  ["label[for='loginPass']", "html", "loginPasswordLabel"],
  ["#loginPass", "placeholder", "login.passwordPlaceholder"],
  ["#togglePasswordButton", "aria-label", "login.showPassword"],
  ["#togglePasswordButton", "title", "login.showPassword"],
  ["#twofa .modal-prompt", "text", "login.twoFactorPrompt"],
  ["label[for='otpCode']", "text", "login.code"],
  ["#loginState", "text", "login.initial"],
  ["#loginCancel", "text", "login.cancel"],
  ["#loginBtn", "html", "login.submit"],
  ["#setTitle", "text", "settings.title"],
  ["#settingsModal label", "text", "settings.interfaceLanguage"],
  ["#closeSettings", "text", "settings.done"],
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const screens = ["import", "manifest", "history", "report"];

document.addEventListener("DOMContentLoaded", () => {
  applyPlatformChrome();
  bindEvents();
  applyI18n();
  renderManifests();
  go("import");
  refreshSession();
});

function normalizeLang(value) {
  return ["zh", "ja", "en"].includes(value) ? value : "zh";
}

function currentLocale() {
  return { zh: "zh-CN", ja: "ja-JP", en: "en-US" }[state.lang] || "zh-CN";
}

function applyPlatformChrome() {
  const isWindows = navigator.userAgent.includes("Windows") || navigator.platform.toLowerCase().startsWith("win");
  document.body.classList.toggle("platform-windows", isWindows);
  document.body.classList.toggle("platform-macos", !isWindows);
}

function t(key, vars = {}) {
  const special = specialI18n(key);
  let value = special ?? I18N[state.lang]?.[key] ?? I18N.zh[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

function specialI18n(key) {
  if (key === "accountButtonHtml") {
    return `<span class="ico">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </span> ${t("login.title")}`;
  }
  if (key === "navImportHtml") return `<span class="g">›</span> ${t("nav.manifests")}`;
  if (key === "navHistoryHtml") return `<span class="g">›</span> ${t("nav.history")}`;
  if (key === "loginUserLabel") return `${t("login.user")} <span class="req">*</span>`;
  if (key === "loginPasswordLabel") return `${t("login.password")} <span class="req">*</span>`;
  return null;
}

function applyI18n() {
  document.documentElement.lang = { zh: "zh-CN", ja: "ja-JP", en: "en" }[state.lang] || "zh-CN";
  document.title = "vrc-blocker";

  STATIC_I18N.forEach(([selector, prop, key]) => {
    const el = $(selector);
    if (!el) return;
    const value = t(key);
    if (prop === "text") el.textContent = value;
    else if (prop === "html") el.innerHTML = value;
    else if (prop === "placeholder") el.setAttribute("placeholder", value);
    else el.setAttribute(prop, value);
  });

  $$("#langSeg button").forEach((button) => {
    button.classList.toggle("on", button.dataset.lang === state.lang);
    button.textContent = t(`lang.${button.dataset.lang}`);
  });

  renderSession();
  renderManifests();
  renderRows();
  renderHistory();
  const r = selectedRow();
  if (r) selectRow(state.selectedRowIndex);
  updateSummary();
  if (state.report && $("#s-report")?.classList.contains("active")) openReport(state.reportNavOrigin);
  if (!activeManifest()) $("#mfName").textContent = t("manifest.none");
  const cfWrite = $("#cfWrite");
  if (cfWrite?.parentElement?.lastChild) cfWrite.parentElement.lastChild.textContent = t("confirm.peopleSuffix");
  updateStartButton();
  updatePasswordToggle();
}

/* ---------------- nav ---------------- */
function go(id) {
  screens.forEach((s) => $("#s-" + s)?.classList.toggle("active", s === id));
  const navId = id === "manifest" ? "import" : id === "report" ? state.reportNavOrigin : id;
  $$(".nitem").forEach((n) => n.classList.toggle("active", n.dataset.go === navId));
  if (id === "history") renderHistory();
  const main = $(".main");
  if (main) main.scrollTop = 0;
}

function bindEvents() {
  // 窗口控制（macOS 红绿灯）
  $("#windowCloseButton")?.addEventListener("click", () => currentWindow?.close());
  $("#windowMinimizeButton")?.addEventListener("click", () => currentWindow?.minimize());
  $("#windowMaximizeButton")?.addEventListener("click", () => currentWindow?.toggleMaximize());
  $("#winWindowCloseButton")?.addEventListener("click", () => currentWindow?.close());
  $("#winWindowMinimizeButton")?.addEventListener("click", () => currentWindow?.minimize());
  $("#winWindowMaximizeButton")?.addEventListener("click", () => currentWindow?.toggleMaximize());

  // 侧边栏导航
  $$("[data-go]").forEach((el) => el.addEventListener("click", () => go(el.dataset.go)));

  // 账号
  $("#accountButton")?.addEventListener("click", openLogin);
  $("#logoutButton")?.addEventListener("click", logout);

  // 导入
  $("#importButton")?.addEventListener("click", () => $("#csvInput").click());
  $("#csvInput")?.addEventListener("change", importSelectedCsv);
  $("#exampleButton")?.addEventListener("click", downloadExampleCsv);

  // 名单详情
  $("#backToImportButton")?.addEventListener("click", () => go("import"));
  $("#rowSearch")?.addEventListener("input", (e) => { state.search = e.target.value; renderRows(); });
  $("#dMemo")?.addEventListener("input", onMemo);
  $("#skipBtn")?.addEventListener("click", toggleSkip);
  $("#openConfirmButton")?.addEventListener("click", openConfirm);

  // 确认
  $("#closeConfirmButton")?.addEventListener("click", closeConfirm);
  $("#chk")?.addEventListener("change", updateStartButton);
  $("#startBtn")?.addEventListener("click", startRun);

  // 执行 / 报告导航
  $("#backBtn")?.addEventListener("click", backToList);
  $("#reportBtn")?.addEventListener("click", () => openReport("import"));
  $("#backToManifestButton")?.addEventListener("click", () => go("manifest"));
  $("#backToListButton")?.addEventListener("click", backToList);
  $("#exportJsonButton")?.addEventListener("click", exportReportJson);
  $("#exportFailedCsvButton")?.addEventListener("click", exportFailedCsv);

  // 登录弹窗
  $("#loginBtn")?.addEventListener("click", doLogin);
  $("#loginCancel")?.addEventListener("click", loginBack);
  $("#togglePasswordButton")?.addEventListener("click", togglePasswordVisibility);
  $("#loginModal")?.addEventListener("click", (e) => { if (e.target === $("#loginModal")) closeLogin(); });
  $("#otpCode")?.addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });

  // 设置弹窗
  $("#openSettings")?.addEventListener("click", openSettings);
  $("#closeSettings")?.addEventListener("click", closeSettings);
  $$("#langSeg button").forEach((b) => b.addEventListener("click", () => setLang(b, b.dataset.lang)));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeLogin(); closeSettings(); }
  });
}

/* ---------------- backend bridge ---------------- */
async function call(command, args = undefined) {
  if (!invoke) {
    throw new Error(t("error.tauriUnavailable"));
  }
  return invoke(command, args);
}

/* ---------------- session ---------------- */
async function refreshSession() {
  if (!invoke) {
    state.session = { accountId: null, userId: null, displayName: null, sessionState: "unknown", lastValidatedAt: null };
    renderSession();
    return;
  }
  try {
    state.session = await call("get_session_status");
  } catch (error) {
    state.session = { accountId: null, userId: null, displayName: null, sessionState: "invalid", lastValidatedAt: null };
    toast(errorMessage(error));
  }
  renderSession();
}

function renderSession() {
  const session = state.session;
  const sessionState = session?.sessionState || "unknown";
  const loggedIn = sessionState === "valid";
  $("#acct").classList.toggle("out", !loggedIn);
  $("#sDot").className = "dot " + sessionDotClass(sessionState);
  $("#sName").textContent = session?.displayName || t("session.unverified");
  $("#sUid").textContent = session?.userId || sessionText(sessionState);
}

function sessionDotClass(sessionState) {
  if (sessionState === "valid") return "";
  if (sessionState === "invalid") return "invalid";
  if (sessionState === "requiresTwoFactor") return "warn";
  return "off";
}

function sessionText(sessionState) {
  return {
    unknown: t("session.waiting"),
    valid: t("session.valid"),
    requiresTwoFactor: t("session.requiresTwoFactor"),
    invalid: t("session.invalid"),
  }[sessionState] || t("session.waiting");
}

function accountLabel() {
  const s = state.session;
  if (!s?.displayName) return t("session.noAccount");
  const uid = s.userId ? ` (${shortUid(s.userId)})` : "";
  return `${s.displayName}${uid}`;
}

async function logout() {
  try {
    await call("logout");
    await refreshSession();
    toast(t("session.loggedOut"));
  } catch (error) {
    toast(errorMessage(error));
  }
}

/* ---------------- import / manifests ---------------- */
async function importSelectedCsv(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = await call("parse_import_text", { text, sourceName: file.name });
    const manifest = {
      id: createId(),
      name: parsed.sourceName || file.name || "import.csv",
      importedAt: new Date().toISOString(),
      rows: parsed.rows,
      summary: parsed.summary,
      status: "ready",
      report: null,
    };
    state.manifests.unshift(manifest);
    saveManifests();
    renderManifests();
    openManifest(manifest.id);
    toast(t("import.imported", { count: parsed.totalRows }));
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    event.target.value = "";
  }
}

async function downloadExampleCsv() {
  try {
    const csv = await call("example_csv");
    const saved = await saveFileWithDialog("vrc_block_list_example.csv", csv, "csv");
    if (saved) toast(t("import.exampleDone"));
  } catch (error) {
    toast(errorMessage(error));
  }
}

function renderManifests() {
  const box = $("#mfList");
  box.innerHTML = "";
  if (state.manifests.length === 0) {
    box.innerHTML = `<div class="panel-empty">${escapeHtml(t("import.noRows"))}</div>`;
  } else {
    state.manifests.forEach((m) => {
      const invalid = invalidCount(m);
      let badge;
      if (m.status === "done" && m.report) {
        badge = `<span class="badge done">${escapeHtml(t("manifest.doneBadge", { success: m.report.summary.success, total: m.report.summary.total }))}</span>`;
      } else if (invalid) {
        badge = `<span class="badge bad">${escapeHtml(t("manifest.fixBadge", { count: invalid }))}</span>`;
      } else {
        badge = `<span class="badge ready">${escapeHtml(t("manifest.readyBadge"))}</span>`;
      }
      const d = document.createElement("div");
      d.className = "mfcard";
      d.innerHTML =
        `<button type="button" class="mfcard-open">
          <div class="ic ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg></div>
          <div class="info"><div class="nm">${escapeHtml(m.name)}</div>
            <div class="meta">${escapeHtml(t("manifest.listMeta", { count: m.rows.length, date: formatDate(m.importedAt) }))}</div></div>
          ${badge}<div class="arr">›</div>
        </button>
        <button type="button" class="mfcard-del iconbtn danger" title="${escapeHtml(t("manifest.delete"))}" aria-label="${escapeHtml(t("manifest.delete"))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>`;
      d.querySelector(".mfcard-open").onclick = () => openManifest(m.id);
      d.querySelector(".mfcard-del").onclick = (e) => { e.stopPropagation(); deleteManifest(m.id); };
      box.appendChild(d);
    });
  }

  const pending = state.manifests.filter((m) => m.status !== "done").length;
  const blocked = state.manifests.reduce((s, m) => s + (m.status === "done" && m.report ? m.report.summary.success : 0), 0);
  $("#mfCountLbl").textContent = t("import.count", { count: state.manifests.length });
  $("#stMf").textContent = state.manifests.length;
  $("#stPending").textContent = pending;
  $("#stBlocked").textContent = blocked;
}

function deleteManifest(id) {
  const m = state.manifests.find((item) => item.id === id);
  if (!m) return;
  if (!confirm(t("manifest.deleteConfirm", { name: m.name }))) return;

  state.manifests = state.manifests.filter((item) => item.id !== id);
  if (state.activeManifestId === id) {
    state.activeManifestId = null;
    state.selectedRowIndex = 0;
  }
  saveManifests();
  renderManifests();
  toast(t("manifest.deleted", { name: m.name }));
}

function loadManifests() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MANIFESTS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((manifest) => Array.isArray(manifest?.rows))
      .map(normalizeStoredManifest)
      .slice(0, MANIFESTS_LIMIT);
  } catch {
    return [];
  }
}

function saveManifests() {
  try {
    localStorage.setItem(MANIFESTS_KEY, JSON.stringify(state.manifests.slice(0, MANIFESTS_LIMIT).map(storedManifestPayload)));
  } catch (error) {
    toast(errorMessage(error));
  }
}

function storedManifestPayload(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    importedAt: manifest.importedAt,
    rows: manifest.rows,
    summary: manifest.summary,
    status: manifest.status,
    report: manifest.report?.summary ? { summary: manifest.report.summary } : null,
  };
}

function normalizeStoredManifest(manifest) {
  const rows = manifest.rows.map(normalizeStoredRow);
  return {
    id: String(manifest.id || createId()),
    name: String(manifest.name || "import.csv"),
    importedAt: manifest.importedAt || new Date().toISOString(),
    rows,
    summary: manifest.summary || { total: rows.length },
    status: manifest.status === "done" ? "done" : "ready",
    report: manifest.report || null,
  };
}

function normalizeStoredRow(row, index) {
  row = row || {};
  const memo = String(row.memo || "");
  return {
    rowIndex: Number.isFinite(row.rowIndex) ? row.rowIndex : index + 1,
    uid: String(row.uid || ""),
    memo,
    normalizedMemo: String(row.normalizedMemo || normalizeMemo(memo)),
    skip: Boolean(row.skip),
    validation: Array.isArray(row.validation) ? row.validation : [],
    status: row.status || "pending",
  };
}

/* ---------------- manifest detail: edit ---------------- */
function openManifest(id) {
  state.activeManifestId = id;
  state.selectedRowIndex = 0;
  state.search = "";
  $("#rowSearch").value = "";
  const m = activeManifest();
  if (m) $("#mfName").textContent = m.name;
  $("#mfEdit").style.display = "block";
  $("#mfConfirm").style.display = "none";
  $("#mfRun").style.display = "none";
  renderRows();
  selectRow(0);
  go("manifest");
}

function renderRows() {
  const m = activeManifest();
  const box = $("#editRows");
  if (!m) { box.innerHTML = `<div class="panel-empty">${escapeHtml(t("manifest.pick"))}</div>`; updateSummary(); return; }

  const f = state.search.trim().toLowerCase();
  box.innerHTML = "";
  let shown = 0;
  m.rows.forEach((r, i) => {
    if (f && !(`${r.uid} ${r.memo} ${r.normalizedMemo}`).toLowerCase().includes(f)) return;
    shown++;
    const invalid = rowIssueCount(r) && !r.skip;
    const d = document.createElement("button");
    d.type = "button";
    d.className = "erow" + (i === state.selectedRowIndex ? " sel" : "") + (r.skip ? " skipped" : "") + (invalid ? " invalid" : "");
    let tag = "";
    if (r.skip) tag = `<span class="etag">${escapeHtml(t("manifest.skippedTag"))}</span>`;
    else if (invalid) tag = `<span class="etag bad">${escapeHtml(t("manifest.needsFix"))}</span>`;
    d.innerHTML =
      `<div class="u">${escapeHtml(shortUid(r.uid))}</div><div class="m">${escapeHtml(r.memo || t("manifest.emptyMemo"))}</div><div class="s">${tag}</div>`;
    d.onclick = () => selectRow(i);
    box.appendChild(d);
  });
  if (shown === 0) box.innerHTML = `<div class="panel-empty">${escapeHtml(t("manifest.noMatch"))}</div>`;
  updateSummary();
}

function selectRow(i) {
  state.selectedRowIndex = i;
  const r = selectedRow();
  if (!r) return;
  $("#dUid").textContent = r.uid;
  $("#dMemo").value = r.memo;
  $("#skipBtn").textContent = r.skip ? t("manifest.restore") : t("manifest.skip");
  updateCount();
  renderIssues(r);
  $$("#editRows .erow").forEach((el, idx) => el.classList.toggle("sel", idx === i));
}

function toggleSkip() {
  const r = selectedRow();
  if (!r) return;
  r.skip = !r.skip;
  saveManifests();
  renderRows();
  selectRow(state.selectedRowIndex);
}

function onMemo() {
  const r = selectedRow();
  if (!r) return;
  r.memo = $("#dMemo").value;
  r.normalizedMemo = normalizeMemo(r.memo);
  saveManifests();
  updateCount();
  renderIssues(r);
  const m = $$("#editRows .erow .m")[state.selectedRowIndex];
  if (m) m.textContent = r.memo || t("manifest.emptyMemo");
}

function updateCount() {
  const v = $("#dMemo").value;
  const c = $("#dCount");
  const len = Array.from(v).length;
  c.textContent = len + " / " + MEMO_LIMIT;
  c.classList.toggle("over", len > MEMO_LIMIT);
}

function renderIssues(row) {
  const issues = [...(row.validation || []), ...localMemoIssues(row)];
  const box = $("#issueList");
  box.innerHTML = (!row.skip && issues.length)
    ? issues.map((i) => `<div class="issue">${escapeHtml(i.message || i)}</div>`).join("")
    : "";
}

function writableCount() {
  const m = activeManifest();
  if (!m) return 0;
  return m.rows.filter((r) => !r.skip).length;
}

function updateSummary() {
  const m = activeManifest();
  const total = m ? m.rows.length : 0;
  const w = writableCount();
  $("#editSummary").textContent = t("manifest.summary", { write: w, skip: total - w });
}

/* ---------------- confirm ---------------- */
function openConfirm() {
  const m = activeManifest();
  if (!m) { toast(t("manifest.noExecutable")); return; }
  if (state.session?.sessionState !== "valid") { toast(t("manifest.loginFirst")); return; }
  const invalid = invalidCount(m);
  if (invalid > 0) { toast(t("manifest.invalidRows", { count: invalid })); return; }
  if (writableCount() === 0) { toast(t("manifest.noWritable")); return; }

  $("#mfEdit").style.display = "none";
  $("#mfConfirm").style.display = "block";
  $("#cfAccount").textContent = accountLabel();
  $("#cfWrite").textContent = writableCount();
  $("#cfWrite").parentElement.lastChild.textContent = t("confirm.peopleSuffix");
  $("#chk").checked = false;
  state.runInFlight = false;
  updateStartButton();
}

function closeConfirm() {
  if (state.runInFlight) return;
  $("#mfConfirm").style.display = "none";
  $("#mfEdit").style.display = "block";
}

/* ---------------- run（后端事件实时推进，最终返回完整报告）--------------- */
async function startRun() {
  if (state.runInFlight) return;
  const m = activeManifest();
  if (!m) return;

  state.runInFlight = true;
  updateStartButton();

  try {
    const result = await call("validate_rows", { rows: m.rows });
    m.rows = Array.isArray(result) ? result[0] : result.rows;
    m.summary = Array.isArray(result) ? result[1] : result.summary;
    saveManifests();
  } catch (error) {
    state.runInFlight = false;
    updateStartButton();
    toast(errorMessage(error));
    return;
  }
  if (invalidCount(m) > 0) {
    state.runInFlight = false;
    updateStartButton();
    toast(t("manifest.stillInvalid"));
    closeConfirm();
    openManifest(m.id);
    return;
  }

  enterRunPending(writableCount());
  await attachRunProgress(writableCount());

  let report;
  try {
    report = await call("start_block_run", {
      request: {
        manifestName: m.name,
        account: state.session,
        rows: m.rows,
        dryRun: false,
        skipFriends: $("#skipFriendsChk")?.checked ?? true,
      },
    });
  } catch (error) {
    state.runInFlight = false;
    detachRunProgress();
    restoreConfirmAfterRunError();
    toast(errorMessage(error));
    return;
  }

  m.report = report;
  m.status = "done";
  state.report = report;
  state.reportManifestName = m.name;
  state.reportAccountLabel = accountLabel();
  state.reportTime = new Date().toLocaleString(currentLocale(), { hour12: false });
  saveManifests();
  saveHistoryEntry(report, {
    manifestName: state.reportManifestName,
    accountLabel: state.reportAccountLabel,
    reportTime: state.reportTime,
  });

  if (state.runProgress?.done > 0) {
    renderMissingRunItems(report);
    finishRun(report);
  } else {
    playReport(report);
  }
}

function updateStartButton() {
  const button = $("#startBtn");
  if (!button) return;
  const checked = $("#chk")?.checked ?? false;
  button.disabled = state.runInFlight || !checked;
  button.innerHTML = state.runInFlight ? t("confirm.running") : t("confirm.start");
}

function enterRunPending(total) {
  clearInterval(state.runTimer);
  $("#mfEdit").style.display = "none";
  $("#mfConfirm").style.display = "none";
  $("#mfRun").style.display = "block";
  $("#term").innerHTML = "";
  $("#reportBtn").style.display = "none";
  $("#backBtn").style.display = "none";
  $("#runLead").textContent = t("run.active");
  $("#sDot").className = "dot warn";
  $("#frac").textContent = "0 / " + total;
  $("#cOk").textContent = "0";
  $("#cBad").textContent = "0";
  $("#cSkip").textContent = "0";
  $("#cLeft").textContent = total;
  $("#fill").style.width = "0%";
  log("info", "", t("run.submitting"));
}

async function attachRunProgress(total) {
  detachRunProgress();
  state.runProgress = {
    total,
    done: 0,
    ok: 0,
    bad: 0,
    skip: 0,
    seenRows: new Set(),
  };

  if (!listen) return;

  try {
    state.runProgressUnlisten = await listen(RUN_PROGRESS_EVENT, (event) => {
      handleRunProgress(event.payload);
    });
  } catch (error) {
    console.warn("run progress listener unavailable", error);
    state.runProgressUnlisten = null;
  }
}

function detachRunProgress() {
  clearInterval(state.runTimer);
  const unlisten = state.runProgressUnlisten;
  state.runProgressUnlisten = null;
  if (typeof unlisten === "function") {
    try { unlisten(); } catch (error) { console.warn("failed to unlisten run progress", error); }
  }
}

function handleRunProgress(event) {
  if (!state.runInFlight || !event || !state.runProgress) return;

  if (event.phase === "started") {
    const total = event.total ?? state.runProgress.total;
    state.runProgress.total = total;
    $("#frac").textContent = "0 / " + total;
    $("#cLeft").textContent = total;
    $("#fill").style.width = "0%";
    log("start", "", t("run.startLog", { total }));
    return;
  }

  if (event.phase === "item" && event.item) {
    renderRunItem(event.item, event.total);
  }
}

function restoreConfirmAfterRunError() {
  clearInterval(state.runTimer);
  $("#mfRun").style.display = "none";
  $("#mfConfirm").style.display = "block";
  $("#mfEdit").style.display = "none";
  $("#sDot").className = "dot " + sessionDotClass(state.session?.sessionState || "unknown");
  updateStartButton();
}

function playReport(report) {
  clearInterval(state.runTimer);
  const items = report.items.slice();
  const total = report.summary.total;
  let i = 0, ok = 0, bad = 0, skip = 0;

  $("#frac").textContent = "0 / " + total;
  $("#cOk").textContent = "0";
  $("#cBad").textContent = "0";
  $("#cSkip").textContent = "0";
  $("#cLeft").textContent = total;
  $("#fill").style.width = "0%";

  log("start", "", t("run.startLog", { total }));

  state.runTimer = setInterval(() => {
    if (i >= items.length) {
      clearInterval(state.runTimer);
      finishRun(report);
      return;
    }
    const it = items[i++];
    const meta = runItemMeta(it.status);
    if (meta.bucket === "ok") ok++;
    else if (meta.bucket === "bad") bad++;
    else skip++;

    const http = primaryHttpStatus(it);
    const detail = itemDetail(it, meta);
    log(meta.stage, shortUid(it.uid), `${http} · ${detail}`);

    const done = ok + bad + skip;
    $("#frac").textContent = done + " / " + total;
    $("#cOk").textContent = ok;
    $("#cBad").textContent = bad;
    $("#cSkip").textContent = skip;
    $("#cLeft").textContent = total - done;
    $("#fill").style.width = Math.round((done / Math.max(total, 1)) * 100) + "%";
  }, 220);
}

function renderRunItem(item, eventTotal) {
  const progress = state.runProgress;
  if (!progress) return;

  const key = `${item.rowIndex}:${item.uid}`;
  if (progress.seenRows.has(key)) return;
  progress.seenRows.add(key);

  const meta = runItemMeta(item.status);
  if (meta.bucket === "ok") progress.ok++;
  else if (meta.bucket === "bad") progress.bad++;
  else progress.skip++;

  progress.done = progress.ok + progress.bad + progress.skip;
  progress.total = eventTotal ?? progress.total;

  const http = primaryHttpStatus(item);
  const detail = itemDetail(item, meta);
  log(meta.stage, shortUid(item.uid), `${http} · ${detail}`);
  updateRunProgressCounters(progress);
}

function renderMissingRunItems(report) {
  const progress = state.runProgress;
  if (!progress) return;
  for (const item of report.items || []) {
    renderRunItem(item, report.summary?.total);
  }
}

function updateRunProgressCounters(progress) {
  const total = progress.total || progress.done;
  $("#frac").textContent = progress.done + " / " + total;
  $("#cOk").textContent = progress.ok;
  $("#cBad").textContent = progress.bad;
  $("#cSkip").textContent = progress.skip;
  $("#cLeft").textContent = Math.max(total - progress.done, 0);
  $("#fill").style.width = Math.round((progress.done / Math.max(total, 1)) * 100) + "%";
}

function finishRun(report) {
  detachRunProgress();
  state.runInFlight = false;
  updateStartButton();
  $("#sDot").className = "dot " + sessionDotClass(state.session?.sessionState || "unknown");
  const s = report.summary;
  $("#runLead").textContent = t("run.doneLead", {
    success: s.success,
    failed: s.failed,
    skipped: s.skipped ? t("run.skippedPart", { skipped: s.skipped }) : "",
  });
  log("done", "", t("run.doneLog", { success: s.success, failed: s.failed }));
  $("#reportBtn").style.display = "inline-flex";
  $("#backBtn").style.display = "inline-flex";

  const m = activeManifest();
  if (m) {
    m.status = "done";
    m.report = report;
    saveManifests();
  }
  renderManifests();
  renderHistory();
}

const TLP = { start: "START", written: "WRITTEN", overwrite: "OVERWRITE", backoff: "BACKOFF", done: "DONE", info: "INFO", failed: "FAILED", skipped: "SKIPPED", friend: "FRIEND" };
function log(stage, uid, txt) {
  const t = $("#term");
  const ln = document.createElement("div");
  ln.className = "logrow";
  const now = new Date().toTimeString().slice(0, 8);
  ln.innerHTML = `<span class="t">${now}</span><span class="tlp ${stage}">${TLP[stage] || stage}</span>` +
    (uid ? `<span class="lu">${escapeHtml(uid)}</span>` : "") + `<span class="lx">${escapeHtml(txt)}</span>`;
  t.appendChild(ln);
  t.scrollTop = t.scrollHeight;
}

function runItemMeta(status) {
  switch (status) {
    case "success": return { bucket: "ok", stage: "written", label: t("run.metaSuccess") };
    case "already_blocked": return { bucket: "ok", stage: "overwrite", label: t("run.metaAlready") };
    case "skipped": return { bucket: "skip", stage: "skipped", label: t("run.metaSkipped") };
    case "skipped_friend": return { bucket: "skip", stage: "friend", label: t("run.metaSkippedFriend") };
    case "failed":
    case "failed_block_after_note":
    case "failed_note_after_block":
      return { bucket: "bad", stage: "failed", label: t("run.metaFailed") };
    default: return { bucket: "ok", stage: "info", label: status };
  }
}

function primaryHttpStatus(item) {
  return item.block?.httpStatus || item.note?.httpStatus || "—";
}

function itemDetail(item, meta = runItemMeta(item.status)) {
  if (item.error) return item.error;
  const parts = [meta.label];
  if (noteNeedsAttention(item)) parts.push(t("run.noteUnverified"));
  return parts.join(" · ");
}

function noteNeedsAttention(item) {
  return ["success", "already_blocked"].includes(item.status) && item.note && item.note.verified === false;
}

function backToList() {
  detachRunProgress();
  state.runInFlight = false;
  renderManifests();
  go("import");
}

/* ---------------- report ---------------- */
function openReport(origin = "import") {
  state.reportNavOrigin = origin;
  const report = state.report;
  if (!report) { toast(t("report.none")); return; }
  $("#rpName").textContent = state.reportManifestName || report.manifestName || "—";
  $("#rpAccount").textContent = state.reportAccountLabel || reportAccountLabel(report) || accountLabel();
  $("#rpTime").textContent = state.reportTime || "—";

  const s = report.summary;
  $("#rpOk").textContent = s.success;
  $("#rpBad").textContent = s.failed;
  $("#rpSkip").textContent = s.skipped;
  $("#rpTotal").textContent = s.total;

  const tb = $("#rpRows");
  tb.innerHTML = "";
  report.items.forEach((it) => {
    const st = reportStatus(it.status);
    const http = primaryHttpStatus(it);
    const detail = reportDetail(it);
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><button type="button" class="uid-copy mono" title="${escapeHtml(it.uid)}">${escapeHtml(shortUid(it.uid))}</button></td>` +
      `<td><span class="rstatus ${st.className}">${st.label}</span></td>` +
      `<td class="num">${http}</td><td>${escapeHtml(detail)}</td>`;
    tr.querySelector(".uid-copy").addEventListener("click", () => copyUid(it.uid));
    tb.appendChild(tr);
  });
  go("report");
}

async function copyUid(uid) {
  if (!uid) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(uid);
    } else {
      const ta = document.createElement("textarea");
      ta.value = uid;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(t("report.copied"));
  } catch (error) {
    toast(errorMessage(error));
  }
}

function reportDetail(item) {
  return itemDetail(item);
}

function reportStatus(status) {
  return {
    success: { label: t("status.success"), className: "ok" },
    failed: { label: t("status.failed"), className: "bad" },
    skipped: { label: t("status.skipped"), className: "skip" },
    skipped_friend: { label: t("status.skippedFriend"), className: "friend" },
    already_blocked: { label: t("status.alreadyBlocked"), className: "warn" },
    failed_block_after_note: { label: t("status.failedBlockAfterNote"), className: "bad" },
    failed_note_after_block: { label: t("status.failedNoteAfterBlock"), className: "bad" },
  }[status] || { label: status, className: "skip" };
}

async function exportReportJson() {
  if (!state.report) { toast(t("report.noneExport")); return; }
  try {
    const saved = await saveFileWithDialog(
      `${safeFileStem(state.reportManifestName || "vrc-blocker-report")}.json`,
      `${JSON.stringify(state.report, null, 2)}\n`,
      "json",
    );
    if (saved) toast(t("report.jsonDone"));
  } catch (error) {
    toast(errorMessage(error));
  }
}

async function exportFailedCsv() {
  if (!state.report) { toast(t("report.noneExport")); return; }
  const failed = state.report.items.filter((it) => !["success", "already_blocked", "skipped", "skipped_friend"].includes(it.status));
  if (failed.length === 0) { toast(t("report.noFailed")); return; }
  const csv = ["uid,memo,error"]
    .concat(failed.map((it) => [it.uid, it.memo, it.error || ""].map(csvCell).join(",")))
    .join("\n");
  try {
    const saved = await saveFileWithDialog(`${safeFileStem(state.reportManifestName || "failed")}_failed.csv`, `${csv}\n`, "csv");
    if (saved) toast(t("report.failedCsvDone"));
  } catch (error) {
    toast(errorMessage(error));
  }
}

/* ---------------- history ---------------- */
function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry?.report?.summary && Array.isArray(entry.report.items)).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistoryEntry(report, meta = {}) {
  if (!report?.summary || !Array.isArray(report.items)) return;
  const id = report.runId || createId();
  const entry = {
    id,
    manifestName: meta.manifestName || report.manifestName || "—",
    accountLabel: meta.accountLabel || reportAccountLabel(report),
    reportTime: meta.reportTime || formatDate(report.finishedAt || report.startedAt || new Date().toISOString()),
    savedAt: new Date().toISOString(),
    report,
  };
  state.history = [entry, ...state.history.filter((item) => item.id !== id)].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch (error) {
    toast(errorMessage(error));
  }
  renderHistory();
}

function renderHistory() {
  const box = $("#historyList");
  if (!box) return;

  $("#historyCountLbl").textContent = t("history.count", { count: state.history.length });
  box.innerHTML = "";

  if (state.history.length === 0) {
    box.innerHTML = `<div class="panel-empty">${escapeHtml(t("history.empty"))}</div>`;
    return;
  }

  state.history.forEach((entry) => {
    const summary = entry.report.summary;
    const failed = Number(summary.failed || 0);
    const badgeClass = failed > 0 ? "bad" : "done";
    const badgeText = failed > 0 ? `${failed} ${t("run.failed")}` : t("status.success");
    const meta = [
      entry.reportTime || formatDate(entry.report.finishedAt || entry.savedAt),
      entry.accountLabel || reportAccountLabel(entry.report),
      t("history.itemMeta", {
        success: summary.success || 0,
        failed: summary.failed || 0,
        skipped: summary.skipped || 0,
      }),
    ].filter(Boolean).join(" · ");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "mfcard";
    button.innerHTML =
      `<div class="ic ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></div>
      <div class="info"><div class="nm">${escapeHtml(entry.manifestName || entry.report.manifestName || "—")}</div>
        <div class="meta">${escapeHtml(meta)}</div></div>
      <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span><div class="arr">›</div>`;
    button.addEventListener("click", () => openHistoryEntry(entry.id));
    box.appendChild(button);
  });
}

function openHistoryEntry(id) {
  const entry = state.history.find((item) => item.id === id);
  if (!entry) return;
  state.report = entry.report;
  state.reportManifestName = entry.manifestName || entry.report.manifestName || "—";
  state.reportAccountLabel = entry.accountLabel || reportAccountLabel(entry.report);
  state.reportTime = entry.reportTime || formatDate(entry.report.finishedAt || entry.savedAt);
  openReport("history");
}

function reportAccountLabel(report) {
  const account = report?.account;
  if (!account) return "";
  if (account.displayName && account.userId) return `${account.displayName} (${shortUid(account.userId)})`;
  return account.displayName || account.userId || "";
}

/* ---------------- login modal ---------------- */
function showLoginCredentials() {
  $("#twofa").style.display = "none";
  $("#loginStep1").style.display = "block";
  $("#loginPass").type = "password";
  updatePasswordToggle();
  $("#loginTitle").textContent = t("login.title");
  $("#loginCancel").textContent = t("login.cancel");
  $("#loginBtn").innerHTML = t("login.submit");
  const st = $("#loginState"); st.textContent = t("login.initial"); st.style.color = "";
}

function togglePasswordVisibility() {
  const input = $("#loginPass");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
  updatePasswordToggle();
  input.focus();
}

function updatePasswordToggle() {
  const input = $("#loginPass");
  const button = $("#togglePasswordButton");
  if (!input || !button) return;
  const visible = input.type === "text";
  button.setAttribute("aria-label", t(visible ? "login.hidePassword" : "login.showPassword"));
  button.setAttribute("title", t(visible ? "login.hidePassword" : "login.showPassword"));
  button.querySelector(".eye-on")?.toggleAttribute("hidden", visible);
  button.querySelector(".eye-off")?.toggleAttribute("hidden", !visible);
}

function openLogin() {
  showLoginCredentials();
  $("#loginModal").classList.add("show");
  setTimeout(() => $("#loginUser").focus(), 0);
}

function closeLogin() {
  $("#loginModal").classList.remove("show");
}

function loginBack() {
  if ($("#twofa").style.display !== "none") showLoginCredentials();
  else closeLogin();
}

async function doLogin() {
  const st = $("#loginState"), tf = $("#twofa");
  if (tf.style.display === "none") {
    const userNameOrEmail = $("#loginUser").value.trim();
    const password = $("#loginPass").value;
    if (!userNameOrEmail || !password) { st.textContent = t("login.missingCredentials"); st.style.color = "var(--error)"; return; }
    st.textContent = t("login.inProgress"); st.style.color = "";
    try {
      const outcome = await call("login", { request: { userNameOrEmail, password, proxy: { mode: "system", url: null } } });
      handleLoginOutcome(outcome);
    } catch (error) {
      st.textContent = errorMessage(error); st.style.color = "var(--error)";
    }
  } else {
    const code = $("#otpCode").value.trim();
    if (!state.pendingChallenge?.challengeId) { st.textContent = t("login.missingChallenge"); st.style.color = "var(--error)"; return; }
    st.textContent = t("login.verifying"); st.style.color = "";
    try {
      const outcome = await call("verify_two_factor", { request: { challengeId: state.pendingChallenge.challengeId, code } });
      handleLoginOutcome(outcome);
    } catch (error) {
      st.textContent = errorMessage(error); st.style.color = "var(--error)";
    }
  }
}

function handleLoginOutcome(outcome) {
  const st = $("#loginState");
  if (outcome.status === "completed") {
    state.session = outcome.account;
    state.pendingChallenge = null;
    st.innerHTML = `<span style='color:var(--success)'>${escapeHtml(t("login.success"))}</span>`;
    setTimeout(() => { renderSession(); closeLogin(); toast(t("login.established")); }, 350);
    return;
  }
  if (outcome.status === "requires_totp" || outcome.status === "requires_email_otp") {
    state.pendingChallenge = { challengeId: outcome.challenge_id || outcome.challengeId, kind: outcome.status };
    $("#loginStep1").style.display = "none";
    $("#twofa").style.display = "block";
    $("#loginTitle").textContent = t("login.twoFactorTitle");
    $("#loginCancel").textContent = t("login.back");
    $("#loginBtn").innerHTML = t("login.submit2fa");
    st.innerHTML = `<span style='color:var(--gold)'>${escapeHtml(outcome.message || t("login.needAuthenticator"))}</span>`;
    const ci = $("#otpCode"); ci.value = ""; setTimeout(() => ci.focus(), 0);
    return;
  }
  st.textContent = outcome.error || t("login.failed"); st.style.color = "var(--error)";
}

/* ---------------- settings modal ---------------- */
function openSettings() { $("#settingsModal").classList.add("show"); }
function closeSettings() { $("#settingsModal").classList.remove("show"); }
function setLang(btn, code) {
  state.lang = normalizeLang(code);
  localStorage.setItem(LANG_KEY, state.lang);
  applyI18n();
  toast(t("settings.changed", { name: t(`lang.${state.lang}`) }));
}

/* ---------------- helpers ---------------- */
function activeManifest() {
  return state.manifests.find((m) => m.id === state.activeManifestId) || null;
}
function selectedRow() {
  const m = activeManifest();
  return m?.rows[state.selectedRowIndex] || null;
}
function invalidCount(manifest) {
  return manifest.rows.filter((r) => !r.skip && rowIssueCount(r)).length;
}
function rowIssueCount(row) {
  return (row.validation?.length || 0) + localMemoIssues(row).length;
}
function localMemoIssues(row) {
  const issues = [];
  const normalized = normalizeMemo(row.memo);
  if (!normalized) issues.push({ message: t("validation.memoRequired") });
  if (Array.from(normalized).length > MEMO_LIMIT) issues.push({ message: t("validation.memoTooLong", { limit: MEMO_LIMIT }) });
  return issues;
}
function normalizeMemo(value) {
  return String(value || "").split(/\s+/).filter(Boolean).join(" ");
}

let toastTimer;
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1900);
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * 弹出系统“保存文件”对话框让用户选择保存位置。
 * 桌面端走后端 save_text_file 命令；浏览器预览回退到 Blob 下载。
 * 返回 true 表示已写入，false 表示用户取消。
 */
async function saveFileWithDialog(defaultName, content, kind) {
  const filter = kind === "json"
    ? { name: "JSON", ext: "json" }
    : { name: "CSV", ext: "csv" };

  if (!invoke) {
    const type = kind === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
    downloadText(defaultName, content, type);
    return true;
  }

  const savedPath = await call("save_text_file", {
    defaultName,
    content,
    filterName: filter.name,
    filterExt: filter.ext,
  });
  return savedPath !== null && savedPath !== undefined;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortUid(uid) {
  if (!uid || uid.length <= 22) return uid || "";
  return `${uid.slice(0, 12)}…${uid.slice(-4)}`;
}

function safeFileStem(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "vrc-blocker-report";
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString(currentLocale(), { hour12: false });
  } catch {
    return value;
  }
}

function createId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error) {
  if (typeof error === "string") return error;
  return error?.message || JSON.stringify(error);
}
