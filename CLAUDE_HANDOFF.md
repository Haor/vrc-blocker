# Claude Handoff

## Current Situation

This repository is a standalone VRChat blocker app:

- GitHub repo: `https://github.com/Haor/vrc-blocker`
- Local path: `/Users/harukishiina/workspace/codex/vrc_blocker/vrc-blocker-app`
- Current branch: `main`
- Current HEAD when this handoff was written: `63a8fe5 Install the Tauri CLI before bundle builds`
- Runtime target: Tauri v2 desktop app with Rust backend and static HTML/CSS/JS frontend.

Important: the current `public/` frontend is **not accepted by the user**. It was adapted too far away from the UI prototype. Do not treat it as the visual source of truth.

The user now wants the frontend handled by Claude. The immediate frontend requirement is:

- Directly reuse the prototype look and layout as much as possible.
- Only make necessary Tauri integration changes.
- Do not redesign the UI structure, spacing, typography, or screen composition away from the prototype.
- Native system titlebar must be hidden.
- The app must use a custom titlebar matching the prototype style, and that titlebar must be draggable.

## Prototype Source of Truth

Use these as the visual and interaction reference:

- Original prototype: `/Users/harukishiina/workspace/codex/vrc_blocker/docs/ui-prototype.html`
- Copied prototype reference in repo: `docs/frontend-prototype.md`

The prototype is structured as a desktop-style app shell:

- outer `desktop` background
- inner `app` window
- 42px custom titlebar with macOS-style traffic lights
- left sidebar rail
- main screens for list/import, manifest edit, confirm, run timeline, report, history
- modal login and settings flows
- timeline/log visual style for execution

For the Tauri app, do not keep the outer fake desktop background if it makes the real window look wrong, but preserve the actual app window composition, titlebar styling, sidebar proportions, page composition, and component styling from the prototype. The previous adaptation changed these too much.

## What Went Wrong

Commit `350b483 Adapt the prototype into a real Tauri shell` split the frontend into `public/index.html`, `public/styles.css`, and `public/app.js`, but it also changed the UI substantially:

- changed the prototype window composition
- changed/sidebar sizing and cards
- removed the prototype's execution timeline view
- changed the import/list/detail/report pages into a different app design
- replaced many visual details instead of preserving them

The user rejected this after launching the local app. The exact issue was that it looked too different from the prototype. Do not continue from that design direction.

## Recommended Frontend Recovery Path

Preferred path:

1. Restore the prototype UI structure from `docs/ui-prototype.html` or from commit `6af594d`'s `public/index.html`.
2. Keep the prototype's layout and styling close to exact.
3. Add Tauri-specific window behavior:
   - `src-tauri/tauri.conf.json` should keep `"decorations": false`.
   - custom titlebar root should use `data-tauri-drag-region`.
   - CSS should include `app-region: drag` and `-webkit-app-region: drag` for drag regions.
   - titlebar buttons should use `app-region: no-drag`.
   - JS should call `window.__TAURI__.window.getCurrentWindow().minimize()`, `toggleMaximize()`, and `close()`.
   - `src-tauri/capabilities/default.json` should include:
     - `core:window:allow-close`
     - `core:window:allow-minimize`
     - `core:window:allow-toggle-maximize`
     - `core:window:allow-start-dragging`
4. Replace prototype mock data gradually with backend commands without changing the visual composition.
5. Preserve the prototype's screen names and flow where practical.

Useful git reference:

```bash
git show 6af594d:public/index.html > /tmp/prototype-public-index.html
```

That commit still had the raw prototype in `public/index.html`. The current repo also contains `docs/frontend-prototype.md`, but the original source file outside the app repo is easier to compare.

## Backend State

The backend is a scaffold, not a complete live blocker yet.

Implemented:

- Tauri v2 app skeleton.
- Rust modules under `src-tauri/src/`.
- CSV parser for `uid,memo`.
- UID/memo validation.
- Dry-run report scaffold.
- VRChat API boundary modules and request intent.
- GitHub workflows for CI and bundle builds.

Important commands currently exposed to frontend:

- `get_session_status()`
- `login(request)`
- `verify_two_factor(request)`
- `logout()`
- `parse_import_file(path)`
- `parse_import_text(text, sourceName)`
- `validate_rows(rows)`
- `example_csv()`
- `start_block_run(request)`
- `get_settings()`
- `save_settings(settings)`

Current command behavior:

- `parse_import_text` works.
- `validate_rows` works.
- `example_csv` works.
- `start_block_run` only builds a scaffold report. With `dryRun: true`, it reports `would_overwrite` and `would_block`; without dry-run, it returns failure items because real network execution is not implemented.
- `login` and `verify_two_factor` are scaffolded and return failure.
- `get_session_status` returns `Unknown`.

Relevant files:

- `src-tauri/src/models.rs`
- `src-tauri/src/commands/auth.rs`
- `src-tauri/src/commands/imports.rs`
- `src-tauri/src/commands/run.rs`
- `src-tauri/src/import/csv_import.rs`
- `src-tauri/src/import/validation.rs`
- `src-tauri/src/run_engine/mod.rs`
- `src-tauri/src/vrchat/`

## Product Requirements From User

Core app behavior:

- This is a VRChat blocking tool.
- Blocking is the primary action.
- Writing online remarks/user notes is a side effect of blocking.
- Note strategy is always overwrite.
- Do not implement append/keep/merge strategies.
- The tool is independent from VRCX.
- VRCX is only a reference or possible source for local testing cookies.
- The app imports a simple CSV containing only `uid,memo`.
- The app should block each UID and overwrite online `userNotes` with `memo`.
- Already-blocked players should still have notes overwritten and should be treated as successful/already-blocked if block verification is satisfied.

Frontend constraints:

- Use Tauri desktop app.
- Static HTML/CSS/JS is acceptable and preferred here.
- No React/Vite requirement.
- Final user should be able to use the app without Node/Python/.NET.
- User specifically wants the prototype reused visually, not redesigned.
- Current `public/` is too different and should be replaced or heavily reverted.

Window/titlebar requirement:

- Native system titlebar must be hidden.
- Custom titlebar should match prototype styling.
- Top titlebar must be draggable.
- Window control buttons must remain clickable, not part of drag region.

## Git History Notes

Important commits:

- `6af594d Establish an independent VRChat blocker delivery baseline`
  - Initial app skeleton.
  - `public/index.html` contained the prototype directly.
- `350b483 Adapt the prototype into a real Tauri shell`
  - Reworked frontend too aggressively.
  - User rejected this UI direction.
- `dd0c6b7 Avoid stuck Windows cache finalizers in Actions`
  - Skips Rust cache on Windows in workflows.
- `63a8fe5 Install the Tauri CLI before bundle builds`
  - Installs `tauri-cli` before `tauri-action` uses `cargo tauri`.

Do not blindly revert all commits after `6af594d`, because workflow fixes in `dd0c6b7` and `63a8fe5` are useful. Prefer restoring/replacing only the frontend files while preserving Tauri config, capabilities, docs, backend, and CI fixes.

Frontend files likely to replace:

- `public/index.html`
- `public/styles.css`
- `public/app.js`

Potentially update docs after frontend is fixed:

- `README.md` currently says `public/` is an adapted Tauri frontend. That statement is not acceptable until the prototype-matching frontend is restored.
- `GOAL.md` currently records the rejected adapted frontend as progress. Update after frontend correction.

## Local Verification Commands

Use these from repo root:

```bash
node --check public/app.js
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo tauri build --debug --no-bundle
```

Local dev app:

```bash
cargo tauri dev
```

The user asked to stop the local dev app after seeing the rejected UI. It was stopped. There should be no active local `cargo tauri dev` session from the previous run.

## CI State At Handoff Time

Recent Actions:

- `ci` for `63a8fe5`: run `28102318654`
  - macOS and Ubuntu had passed during handoff.
  - Windows was still running tests when the user asked to stop frontend work.
- `build` for `63a8fe5`: run `28102318600`
  - in progress at handoff time.

Earlier result:

- `ci` for `350b483`: run `28101613787` succeeded.
- `build` for `350b483`: run `28101613796` failed because `cargo tauri` was not installed on runners.
- `63a8fe5` should fix that by installing `tauri-cli 2.11.3`.

Check current state with:

```bash
gh run list --repo Haor/vrc-blocker --limit 10
```

## Security And Data Handling

Do not commit:

- real VRCX databases
- cookies
- local test CSVs with real UIDs
- full real block lists
- live smoke reports
- passwords, TOTP codes, or session tokens

Ignored paths already include local test/report patterns. Keep local live smoke artifacts under ignored paths such as `local-test/`.

## Suggested Next Step For Claude

First task should be frontend recovery only:

1. Compare current `public/` against the prototype.
2. Replace current frontend with a prototype-faithful Tauri version.
3. Preserve custom draggable titlebar and window controls.
4. Wire only minimal safe backend commands needed for import/dry-run without visually redesigning.
5. Run local app and ask the user to visually confirm before further backend work.

Do not implement new backend blocking logic until the user accepts the restored UI direction.
