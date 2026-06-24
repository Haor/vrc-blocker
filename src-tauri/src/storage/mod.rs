use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AppStoragePaths {
    pub app_data_dir: PathBuf,
    pub reports_dir: PathBuf,
}

impl AppStoragePaths {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let reports_dir = app_data_dir.join("reports");
        Self {
            app_data_dir,
            reports_dir,
        }
    }
}
