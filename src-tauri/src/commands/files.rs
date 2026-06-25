use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// 弹出系统“保存文件”对话框，用户选定路径后写入文本内容。
///
/// 返回:
/// - `Ok(Some(path))`  已保存到 path
/// - `Ok(None)`        用户取消了保存对话框
/// - `Err(message)`    写入失败
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    default_name: String,
    content: String,
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file().set_file_name(&default_name);

    if let (Some(name), Some(ext)) = (filter_name.as_deref(), filter_ext.as_deref()) {
        builder = builder.add_filter(name, &[ext]);
    }

    // blocking_save_file 在对话框线程上阻塞，放进 spawn_blocking 避免占用异步执行器。
    let chosen = tokio::task::spawn_blocking(move || builder.blocking_save_file())
        .await
        .map_err(|error| error.to_string())?;

    let Some(path) = chosen else {
        return Ok(None);
    };

    let path_buf = path
        .into_path()
        .map_err(|error| format!("无法解析保存路径：{error}"))?;

    std::fs::write(&path_buf, content.as_bytes())
        .map_err(|error| format!("写入文件失败：{error}"))?;

    Ok(Some(path_buf.to_string_lossy().to_string()))
}
