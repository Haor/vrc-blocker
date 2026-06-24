use crate::import::csv_import;
use crate::import::validation;
use crate::models::{ImportRow, ParsedImport, ValidationSummary};
use std::path::Path;

#[tauri::command]
pub fn parse_import_file(path: String) -> Result<ParsedImport, String> {
    csv_import::parse_import_file(Path::new(&path)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn parse_import_text(
    text: String,
    source_name: Option<String>,
) -> Result<ParsedImport, String> {
    csv_import::parse_import_text(&text, source_name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn validate_rows(
    mut rows: Vec<ImportRow>,
) -> Result<(Vec<ImportRow>, ValidationSummary), String> {
    let summary = validation::validate_rows(&mut rows);
    Ok((rows, summary))
}

#[tauri::command]
pub fn example_csv() -> Result<String, String> {
    Ok(csv_import::example_csv().to_string())
}
