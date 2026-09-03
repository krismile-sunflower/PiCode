use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const TEXT_PREVIEW_LIMIT: u64 = 1024 * 1024;
const IMAGE_PREVIEW_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFilesRequest {
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: Option<u64>,
    pub mtime: Option<u128>,
}

#[derive(Debug, Serialize)]
pub struct FileListResponse {
    pub path: String,
    pub items: Vec<FileItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentResponse {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub mime_type: String,
    pub size: u64,
    pub mtime: Option<u128>,
    pub content: Option<String>,
    pub encoding: Option<String>,
    pub truncated: bool,
    pub language: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInstructions {
    pub path: String,
    pub exists: bool,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteProjectInstructionsRequest {
    pub path: String,
    pub content: String,
}

/// Cap on the project instruction file, which is prepended to every turn.
const INSTRUCTIONS_LIMIT: u64 = 256 * 1024;

fn instructions_path(project: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project)
        .canonicalize()
        .map_err(|err| format!("无法访问工作区：{err}"))?;
    if !root.is_dir() {
        return Err("工作区路径不是目录。".to_string());
    }
    Ok(root.join("AGENTS.md"))
}

/// Read the project's `AGENTS.md`.
///
/// This is project-level instruction, not a user-level prompt template: the
/// two were previously conflated under the prompts UI even though only one of
/// them travels with the repository.
#[tauri::command]
pub async fn read_project_instructions(path: String) -> Result<ProjectInstructions, String> {
    tokio::task::spawn_blocking(move || {
        let file = instructions_path(&path)?;
        if !file.exists() {
            return Ok(ProjectInstructions {
                path: file.display().to_string(),
                exists: false,
                content: String::new(),
            });
        }
        let metadata = fs::metadata(&file).map_err(|err| err.to_string())?;
        if metadata.len() > INSTRUCTIONS_LIMIT {
            return Err("AGENTS.md 过大，请在编辑器中处理。".to_string());
        }
        Ok(ProjectInstructions {
            path: file.display().to_string(),
            exists: true,
            content: fs::read_to_string(&file).map_err(|err| err.to_string())?,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn write_project_instructions(
    request: WriteProjectInstructionsRequest,
) -> Result<ProjectInstructions, String> {
    tokio::task::spawn_blocking(move || {
        let file = instructions_path(&request.path)?;
        if request.content.len() as u64 > INSTRUCTIONS_LIMIT {
            return Err("AGENTS.md 过大，请精简后再保存。".to_string());
        }
        // Atomic replace so a failed write cannot leave the repo with a
        // half-written instruction file that Pi would still load.
        let temp = file.with_extension("md.tmp");
        fs::write(&temp, &request.content).map_err(|err| err.to_string())?;
        fs::rename(&temp, &file).map_err(|err| {
            let _ = fs::remove_file(&temp);
            err.to_string()
        })?;
        crate::audit::ok(
            "project.instructions_saved",
            serde_json::json!({ "path": file.display().to_string(), "bytes": request.content.len() }),
        );
        Ok(ProjectInstructions {
            path: file.display().to_string(),
            exists: true,
            content: request.content,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilesRequest {
    pub path: String,
    pub query: String,
    pub limit: Option<usize>,
}

/// Directories that are never worth walking for an `@` mention.
const SEARCH_IGNORED: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
    ".upstream-tau",
    "coverage",
    ".turbo",
];

/// Bound on how much of the tree a single mention lookup may walk.
const SEARCH_SCAN_LIMIT: usize = 20_000;

/// Fuzzy-find workspace files for `@` mentions in the composer.
///
/// Ranks by subsequence match with a bias toward matches in the file name, so
/// typing `@ctrl` finds `src/app/controller.ts` before a directory that merely
/// contains those letters somewhere in its path.
#[tauri::command]
pub async fn search_project_files(
    request: SearchFilesRequest,
) -> Result<Vec<FileItem>, String> {
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&request.path)
            .canonicalize()
            .map_err(|err| format!("无法访问工作区：{err}"))?;
        let query = request.query.trim().to_lowercase();
        let limit = request.limit.unwrap_or(30).clamp(1, 200);

        let mut scanned = 0usize;
        let mut scored: Vec<(i64, FileItem)> = Vec::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            if scanned >= SEARCH_SCAN_LIMIT {
                break;
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if SEARCH_IGNORED.contains(&name.as_str()) || name.starts_with('.') {
                    continue;
                }
                let path = entry.path();
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if metadata.is_dir() {
                    stack.push(path);
                    continue;
                }
                scanned += 1;
                let relative = path
                    .strip_prefix(&root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let Some(score) = fuzzy_score(&relative, &name, &query) else {
                    continue;
                };
                scored.push((
                    score,
                    FileItem {
                        name: relative.clone(),
                        path: path.display().to_string(),
                        is_directory: false,
                        size: Some(metadata.len()),
                        mtime: metadata
                            .modified()
                            .ok()
                            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|duration| duration.as_millis()),
                    },
                ));
            }
        }

        scored.sort_by(|left, right| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| left.1.name.len().cmp(&right.1.name.len()))
        });
        Ok(scored.into_iter().take(limit).map(|(_, item)| item).collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Higher is better; `None` means the query does not match at all.
fn fuzzy_score(relative: &str, name: &str, query: &str) -> Option<i64> {
    if query.is_empty() {
        return Some(0);
    }
    let haystack = relative.to_lowercase();
    let file_name = name.to_lowercase();
    if let Some(index) = file_name.find(query) {
        // Contiguous hit in the file name is the strongest signal.
        return Some(1_000 - index as i64);
    }
    if let Some(index) = haystack.find(query) {
        return Some(600 - index as i64);
    }
    // Fall back to a subsequence match over the whole relative path.
    let mut characters = query.chars();
    let mut needle = characters.next()?;
    let mut matched = 0i64;
    for character in haystack.chars() {
        if character == needle {
            matched += 1;
            match characters.next() {
                Some(next) => needle = next,
                None => return Some(200 + matched),
            }
        }
    }
    None
}

#[tauri::command]
pub async fn list_files(request: ListFilesRequest) -> Result<FileListResponse, String> {
    list_files_inner(request.path.map(PathBuf::from))
}

pub fn list_files_inner(path: Option<PathBuf>) -> Result<FileListResponse, String> {
    let dir =
        path.unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir.display()));
    }

    let ignored = [
        "node_modules",
        ".git",
        "__pycache__",
        ".next",
        "dist",
        "target",
        ".upstream-tau",
    ];

    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if ignored.contains(&name.as_str()) {
            continue;
        }
        if name.starts_with('.') && name != ".env" {
            continue;
        }

        let path = entry.path();
        let metadata = entry.metadata().ok();
        let is_directory = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = metadata
            .as_ref()
            .and_then(|m| if m.is_file() { Some(m.len()) } else { None });
        let mtime = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis());

        items.push(FileItem {
            name,
            path: path.display().to_string(),
            is_directory,
            size,
            mtime,
        });
    }

    items.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(FileListResponse {
        path: dir.display().to_string(),
        items,
    })
}

pub fn canonical_workspace_path(root: &Path, requested: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root)
        .map_err(|err| format!("Failed to resolve workspace root {}: {err}", root.display()))?;
    let requested = fs::canonicalize(requested)
        .map_err(|err| format!("Failed to resolve file {}: {err}", requested.display()))?;
    if requested != root && !requested.starts_with(&root) {
        return Err("Requested path is outside the active workspace".to_string());
    }
    Ok(requested)
}

pub fn read_file_content(path: &Path) -> Result<FileContentResponse, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    if !metadata.is_file() {
        return Err(format!("Not a file: {}", path.display()));
    }

    let size = metadata.len();
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis());
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let language = language_for_extension(&extension).to_string();

    if let Some(mime_type) = image_mime_type(&extension) {
        if size > IMAGE_PREVIEW_LIMIT {
            return Ok(unsupported_content(
                path,
                name,
                size,
                mtime,
                language,
                "图片超过 8 MiB，请在 VS Code 中查看。",
            ));
        }
        let bytes = fs::read(path).map_err(|err| err.to_string())?;
        return Ok(FileContentResponse {
            path: path.display().to_string(),
            name,
            kind: "image".into(),
            mime_type: mime_type.into(),
            size,
            mtime,
            content: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            encoding: Some("base64".into()),
            truncated: false,
            language,
            reason: None,
        });
    }

    let truncated = size > TEXT_PREVIEW_LIMIT;
    let mut bytes = Vec::with_capacity(size.min(TEXT_PREVIEW_LIMIT) as usize);
    File::open(path)
        .map_err(|err| err.to_string())?
        .take(TEXT_PREVIEW_LIMIT)
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;

    let text = match std::str::from_utf8(&bytes) {
        Ok(value) => value.to_string(),
        Err(error) if truncated && error.error_len().is_none() => {
            String::from_utf8(bytes[..error.valid_up_to()].to_vec())
                .map_err(|err| err.to_string())?
        }
        Err(_) => {
            return Ok(unsupported_content(
                path,
                name,
                size,
                mtime,
                language,
                "此文件不是可预览的 UTF-8 文本。",
            ))
        }
    };

    Ok(FileContentResponse {
        path: path.display().to_string(),
        name,
        kind: "text".into(),
        mime_type: text_mime_type(&extension).into(),
        size,
        mtime,
        content: Some(text),
        encoding: Some("utf8".into()),
        truncated,
        language,
        reason: None,
    })
}

fn unsupported_content(
    path: &Path,
    name: String,
    size: u64,
    mtime: Option<u128>,
    language: String,
    reason: &str,
) -> FileContentResponse {
    FileContentResponse {
        path: path.display().to_string(),
        name,
        kind: "unsupported".into(),
        mime_type: "application/octet-stream".into(),
        size,
        mtime,
        content: None,
        encoding: None,
        truncated: false,
        language,
        reason: Some(reason.into()),
    }
}

fn image_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn text_mime_type(extension: &str) -> &'static str {
    match extension {
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "md" | "markdown" => "text/markdown",
        _ => "text/plain",
    }
}

fn language_for_extension(extension: &str) -> &'static str {
    match extension {
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "jsx" => "jsx",
        "tsx" => "tsx",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "rb" => "ruby",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" | "svg" => "xml",
        "md" | "markdown" => "markdown",
        "sh" | "bash" | "zsh" => "shell",
        _ => "text",
    }
}

pub fn open_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|err| err.to_string())
}

pub fn open_in_vscode(
    app: &tauri::AppHandle,
    path: &Path,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), String> {
    let file_url = Url::from_file_path(path)
        .map_err(|_| format!("Unable to create a VS Code URL for {}", path.display()))?;
    let mut vscode_url = format!("vscode://file{}", file_url.path());
    if let Some(line) = line {
        vscode_url.push_str(&format!(":{}:{}", line.max(1), column.unwrap_or(1).max(1)));
    }
    app.opener()
        .open_url(vscode_url, None::<&str>)
        .map_err(|err| format!("Failed to open VS Code: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("pi-studio-{label}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn fuzzy_scoring_prefers_file_name_matches() {
        let name_hit = super::fuzzy_score("src/app/controller.ts", "controller.ts", "ctrl");
        let path_hit = super::fuzzy_score("src/ctrl/other.ts", "other.ts", "ctrl");
        assert!(name_hit.is_some() && path_hit.is_some());
        assert!(path_hit.unwrap() > name_hit.unwrap(), "contiguous path hits outrank subsequences");
        assert_eq!(super::fuzzy_score("a/b.ts", "b.ts", "zzz"), None);
    }

    #[test]
    fn workspace_path_rejects_files_outside_root() {
        let root = test_dir("root");
        let outside = test_dir("outside");
        fs::create_dir_all(&root).expect("create root");
        fs::create_dir_all(&outside).expect("create outside");
        let inside_file = root.join("inside.txt");
        let outside_file = outside.join("outside.txt");
        fs::write(&inside_file, "inside").expect("write inside");
        fs::write(&outside_file, "outside").expect("write outside");

        assert!(canonical_workspace_path(&root, &inside_file).is_ok());
        assert!(canonical_workspace_path(&root, &outside_file).is_err());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn file_content_distinguishes_text_and_binary() {
        let root = test_dir("preview");
        fs::create_dir_all(&root).expect("create root");
        let text_file = root.join("main.rs");
        let binary_file = root.join("data.bin");
        fs::write(&text_file, "fn main() {}\n").expect("write text");
        fs::write(&binary_file, [0xff, 0xfe, 0xfd]).expect("write binary");

        let text = read_file_content(&text_file).expect("read text");
        assert_eq!(text.kind, "text");
        assert_eq!(text.language, "rust");
        assert_eq!(text.content.as_deref(), Some("fn main() {}\n"));

        let binary = read_file_content(&binary_file).expect("read binary");
        assert_eq!(binary.kind, "unsupported");
        assert!(binary.content.is_none());

        let _ = fs::remove_dir_all(root);
    }
}
