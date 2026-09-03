//! Git worktree isolation for agent sessions.
//!
//! Pi edits the working directory it is started in. Without an isolation layer
//! the only way to run two tasks on one repository is to let them fight over
//! the same files. A detached worktree gives a task its own checkout, so work
//! can be reviewed and merged deliberately instead of landing in place — and,
//! because each worktree is a distinct path, the existing one-process-per-path
//! model gives parallel sessions for free.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde::{Deserialize, Serialize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Upper bound on live worktrees per repository, so an agent-heavy week cannot
/// quietly fill the disk with abandoned checkouts.
const MAX_WORKTREES: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub name: String,
    pub head: String,
    pub branch: Option<String>,
    pub has_changes: bool,
    pub belongs_to_project: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeRequest {
    pub path: String,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorktreeRequest {
    pub path: String,
    pub worktree_path: String,
    #[serde(default)]
    pub discard_changes: bool,
}

fn git(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .output()
        .map_err(|error| format!("无法运行 Git：{error}"))
}

fn git_text(root: &Path, args: &[&str]) -> Option<String> {
    let output = git(root, args).ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn require(action: &str, output: Output) -> Result<String, String> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        format!("{action}失败。")
    } else {
        format!("{action}失败：{detail}")
    })
}

fn repository_root(path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("无法访问工作区：{error}"))?;
    let inside = git_text(&root, &["rev-parse", "--is-inside-work-tree"]);
    if inside.as_deref() != Some("true") {
        return Err("当前文件夹不是 Git 仓库，无法创建隔离副本。".to_string());
    }
    let top = git_text(&root, &["rev-parse", "--show-toplevel"])
        .ok_or_else(|| "无法定位仓库根目录。".to_string())?;
    PathBuf::from(top)
        .canonicalize()
        .map_err(|error| format!("无法定位仓库根目录：{error}"))
}

/// `~/.pi/agent/worktrees` — kept out of the repository so a stray worktree
/// never shows up as untracked noise in the user's own checkout.
fn worktrees_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户目录。".to_string())?;
    let root = home.join(".pi").join("agent").join("worktrees");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

/// Turn a user-supplied label into something safe for a directory name.
pub fn sanitize_label(label: &str) -> String {
    let cleaned = label
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = cleaned.trim_matches('-').to_string();
    let short = trimmed.chars().take(32).collect::<String>();
    if short.is_empty() {
        "task".to_string()
    } else {
        short
    }
}

fn parse_worktree_list(text: &str, repo_root: &Path) -> Vec<WorktreeInfo> {
    let mut result = Vec::new();
    let mut current: Option<WorktreeInfo> = None;
    let root_display = repo_root.display().to_string();
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                result.push(entry);
            }
            let path_buf = PathBuf::from(path);
            let name = path_buf
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());
            current = Some(WorktreeInfo {
                path: path.to_string(),
                name,
                head: String::new(),
                branch: None,
                has_changes: false,
                belongs_to_project: !same_path(path, &root_display),
            });
        } else if let Some(head) = line.strip_prefix("HEAD ") {
            if let Some(entry) = current.as_mut() {
                entry.head = head.to_string();
            }
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(entry) = current.as_mut() {
                entry.branch = Some(branch.trim_start_matches("refs/heads/").to_string());
            }
        }
    }
    if let Some(entry) = current.take() {
        result.push(entry);
    }
    result
}

fn same_path(left: &str, right: &str) -> bool {
    let normalize = |value: &str| value.replace('\\', "/").trim_end_matches('/').to_lowercase();
    normalize(left) == normalize(right)
}

/// Worktrees of this repository that PiCode manages.
#[tauri::command]
pub async fn list_session_worktrees(path: String) -> Result<Vec<WorktreeInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(&path)?;
        let managed = worktrees_root()?.display().to_string();
        let listing = git_text(&root, &["worktree", "list", "--porcelain"]).unwrap_or_default();
        let mut entries = parse_worktree_list(&listing, &root)
            .into_iter()
            .filter(|entry| {
                entry.belongs_to_project
                    && entry
                        .path
                        .replace('\\', "/")
                        .to_lowercase()
                        .starts_with(&managed.replace('\\', "/").to_lowercase())
            })
            .collect::<Vec<_>>();
        for entry in &mut entries {
            let worktree = PathBuf::from(&entry.path);
            entry.has_changes = git_text(&worktree, &["status", "--porcelain"])
                .map(|text| !text.trim().is_empty())
                .unwrap_or(false);
        }
        Ok(entries)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Create a detached worktree for one agent session.
#[tauri::command]
pub async fn create_session_worktree(
    request: CreateWorktreeRequest,
) -> Result<WorktreeInfo, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(&request.path)?;
        if git_text(&root, &["rev-parse", "--verify", "HEAD"]).is_none() {
            return Err("仓库还没有任何提交，无法创建隔离副本。".to_string());
        }

        let existing = git_text(&root, &["worktree", "list", "--porcelain"]).unwrap_or_default();
        let managed_prefix = worktrees_root()?.display().to_string().replace('\\', "/").to_lowercase();
        let live = parse_worktree_list(&existing, &root)
            .into_iter()
            .filter(|entry| {
                entry.belongs_to_project
                    && entry.path.replace('\\', "/").to_lowercase().starts_with(&managed_prefix)
            })
            .count();
        if live >= MAX_WORKTREES {
            return Err(format!(
                "隔离副本已达上限 {MAX_WORKTREES} 个，请先在设置中移除不再需要的副本。"
            ));
        }

        let repo_name = root
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "repo".to_string());
        let label = sanitize_label(request.label.as_deref().unwrap_or("task"));
        let base = worktrees_root()?.join(format!("{}-{label}", sanitize_label(&repo_name)));
        let mut target = base.clone();
        let mut suffix = 2;
        while target.exists() {
            target = PathBuf::from(format!("{}-{suffix}", base.display()));
            suffix += 1;
            if suffix > 64 {
                return Err("无法为隔离副本找到可用目录名。".to_string());
            }
        }

        let target_display = target.display().to_string();
        require(
            "创建隔离副本",
            git(&root, &["worktree", "add", "--detach", &target_display, "HEAD"])?,
        )?;
        crate::audit::ok(
            "worktree.create",
            serde_json::json!({ "repo": root.display().to_string(), "path": target_display }),
        );

        let head = git_text(&target, &["rev-parse", "HEAD"]).unwrap_or_default();
        Ok(WorktreeInfo {
            path: target_display,
            name: target
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| label.clone()),
            head,
            branch: None,
            has_changes: false,
            belongs_to_project: true,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Remove a managed worktree, refusing to discard work unless asked to.
#[tauri::command]
pub async fn remove_session_worktree(
    request: RemoveWorktreeRequest,
) -> Result<Vec<WorktreeInfo>, String> {
    let listing_path = request.path.clone();
    tokio::task::spawn_blocking(move || {
        let root = repository_root(&request.path)?;
        let managed = worktrees_root()?.display().to_string().replace('\\', "/").to_lowercase();
        let target = request.worktree_path.replace('\\', "/").to_lowercase();
        // Only ever remove checkouts PiCode created: `git worktree remove` on
        // the user's own checkout would delete their working directory.
        if !target.starts_with(&managed) {
            return Err("只能移除 PiCode 创建的隔离副本。".to_string());
        }
        let has_changes = git_text(Path::new(&request.worktree_path), &["status", "--porcelain"])
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false);
        if has_changes && !request.discard_changes {
            return Err("该副本仍有未提交改动。确认丢弃后再移除。".to_string());
        }

        let mut args = vec!["worktree", "remove"];
        if request.discard_changes {
            args.push("--force");
        }
        args.push(&request.worktree_path);
        require("移除隔离副本", git(&root, &args)?)?;
        crate::audit::record(
            "worktree.remove",
            if has_changes { "discarded" } else { "ok" },
            serde_json::json!({ "path": request.worktree_path, "hadChanges": has_changes }),
        );
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    list_session_worktrees(listing_path).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_become_safe_directory_names() {
        assert_eq!(sanitize_label("Fix login bug"), "Fix-login-bug");
        assert_eq!(sanitize_label("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize_label("   "), "task");
        assert_eq!(sanitize_label("a".repeat(80).as_str()).len(), 32);
    }

    #[test]
    fn porcelain_listing_separates_the_main_checkout() {
        let text = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /home/u/.pi/agent/worktrees/repo-task\nHEAD def\ndetached\n";
        let entries = parse_worktree_list(text, Path::new("/repo"));
        assert_eq!(entries.len(), 2);
        assert!(!entries[0].belongs_to_project, "the repo's own checkout is not an isolated copy");
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(entries[1].belongs_to_project);
        assert_eq!(entries[1].name, "repo-task");
        assert_eq!(entries[1].head, "def");
    }
}
