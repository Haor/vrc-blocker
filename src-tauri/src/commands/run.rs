use crate::models::{RunReport, StartRunRequest};
use crate::run_engine;

#[tauri::command]
pub async fn start_block_run(request: StartRunRequest) -> Result<RunReport, String> {
    Ok(run_engine::build_scaffold_report(request))
}
