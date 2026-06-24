use crate::error::{AppError, AppResult};
use crate::import::validation;
use crate::models::{ImportRow, ParsedImport};
use csv::{ReaderBuilder, StringRecord, Trim};
use std::fs;
use std::path::Path;

pub fn example_csv() -> &'static str {
    "uid,memo\nusr_00000000-0000-4000-8000-000000000001,风险等级：高；类别：示例；名称：示例用户A；来源：示例名单；原因：示例原因；备注：演示数据\nusr_00000000-0000-4000-8000-000000000002,风险等级：中；类别：示例；名称：示例用户B；来源：示例名单；原因：示例原因；备注：演示数据\n"
}

pub fn parse_import_file(path: &Path) -> AppResult<ParsedImport> {
    let text = fs::read_to_string(path)?;
    let source_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string());
    parse_import_text(&text, source_name)
}

pub fn parse_import_text(text: &str, source_name: Option<String>) -> AppResult<ParsedImport> {
    let mut reader = ReaderBuilder::new()
        .flexible(true)
        .trim(Trim::Headers)
        .from_reader(text.as_bytes());

    let headers = reader.headers()?.clone();
    let uid_index = header_index(&headers, "uid")
        .ok_or_else(|| AppError::invalid_input("CSV header must include uid"))?;
    let memo_index = header_index(&headers, "memo")
        .ok_or_else(|| AppError::invalid_input("CSV header must include memo"))?;

    let mut rows = Vec::new();
    for (offset, record) in reader.records().enumerate() {
        let record = record?;
        rows.push(ImportRow::new(
            offset + 2,
            field(&record, uid_index).trim().to_string(),
            field(&record, memo_index).trim().to_string(),
        ));
    }

    let summary = validation::validate_rows(&mut rows);
    Ok(ParsedImport {
        source_name,
        encoding: "utf-8".to_string(),
        total_rows: rows.len(),
        rows,
        summary,
    })
}

fn header_index(headers: &StringRecord, target: &str) -> Option<usize> {
    headers
        .iter()
        .position(|header| header.trim().trim_start_matches('\u{feff}') == target)
}

fn field(record: &StringRecord, index: usize) -> &str {
    record.get(index).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ValidationIssueKind;

    #[test]
    fn parses_and_validates_minimal_csv() {
        let parsed = parse_import_text(example_csv(), Some("example.csv".to_string())).unwrap();
        assert_eq!(parsed.total_rows, 2);
        assert_eq!(parsed.summary.valid, 2);
        assert_eq!(
            parsed.rows[0].uid,
            "usr_00000000-0000-4000-8000-000000000001"
        );
    }

    #[test]
    fn reports_duplicate_uid() {
        let parsed = parse_import_text(
            "uid,memo\nusr_00000000-0000-4000-8000-000000000001,a\nusr_00000000-0000-4000-8000-000000000001,b\n",
            None,
        )
        .unwrap();
        assert_eq!(parsed.summary.duplicate, 1);
        assert_eq!(
            parsed.rows[1].validation[0].kind,
            ValidationIssueKind::Duplicate
        );
    }
}
