use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

use serde::Serialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    path: String,
    original_path: Option<String>,
    index_status: String,
    worktree_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    root: String,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    is_repository: bool,
    changes: Vec<GitChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    path: String,
    diff: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    summary: String,
    output: String,
}

fn git_output(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never");
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
        .output()
        .map_err(|error| format!("无法运行 Git：{error}"))
}

fn output_text(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => String::new(),
    }
}

fn require_success(action: &str, output: Output) -> Result<Output, String> {
    if output.status.success() {
        Ok(output)
    } else {
        let detail = output_text(&output);
        Err(if detail.is_empty() {
            format!("{action}失败，Git 未返回错误详情。")
        } else {
            format!("{action}失败：{detail}")
        })
    }
}

fn canonical_root(path: String) -> Result<PathBuf, String> {
    PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("无法访问工作区：{error}"))
}

fn is_repository(root: &Path) -> Result<bool, String> {
    let probe = git_output(root, &["rev-parse", "--is-inside-work-tree"])?;
    Ok(probe.status.success() && String::from_utf8_lossy(&probe.stdout).trim() == "true")
}

fn repository_root(path: String) -> Result<PathBuf, String> {
    let root = canonical_root(path)?;
    if !is_repository(&root)? {
        return Err("当前文件夹不是 Git 仓库。".to_string());
    }
    Ok(root)
}

fn optional_git_text(root: &Path, args: &[&str]) -> Option<String> {
    let output = git_output(root, args).ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn branch_from_header(line: &str) -> Option<String> {
    let value = line.strip_prefix("## ")?;
    let branch = value
        .strip_prefix("No commits yet on ")
        .or_else(|| value.strip_prefix("Initial commit on "))
        .unwrap_or(value);
    let branch = branch
        .split_once("...")
        .map(|(name, _)| name)
        .unwrap_or(branch);
    let branch = branch
        .split_once(" [")
        .map(|(name, _)| name)
        .unwrap_or(branch)
        .trim();
    (!branch.is_empty()).then(|| branch.to_string())
}

fn upstream_distance(root: &Path) -> (u32, u32) {
    let Some(counts) = optional_git_text(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    ) else {
        return (0, 0);
    };
    let mut parts = counts.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (ahead, behind)
}

fn operation_result(summary: &str, output: Output) -> GitOperationResult {
    GitOperationResult {
        summary: summary.to_string(),
        output: output_text(&output),
    }
}

fn validated_file_paths(file_paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for file_path in file_paths {
        if file_path.is_empty() {
            continue;
        }
        let path = Path::new(&file_path);
        if path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(format!("文件不在当前工作区内：{file_path}"));
        }
        if !result.contains(&file_path) {
            result.push(file_path);
        }
    }
    if result.is_empty() {
        return Err("没有选择需要操作的文件。".to_string());
    }
    Ok(result)
}

fn git_output_with_paths(
    root: &Path,
    leading_args: &[&str],
    file_paths: &[String],
) -> Result<Output, String> {
    let mut args = leading_args
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    args.extend(file_paths.iter().cloned());
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    git_output(root, &refs)
}

fn has_head(root: &Path) -> bool {
    git_output(root, &["rev-parse", "--verify", "HEAD"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn get_git_status(path: String) -> Result<GitStatus, String> {
    tokio::task::spawn_blocking(move || {
        let root = canonical_root(path)?;
        if !is_repository(&root)? {
            return Ok(GitStatus {
                root: root.display().to_string(),
                branch: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                is_repository: false,
                changes: Vec::new(),
            });
        }
        let output = require_success(
            "读取 Git 状态",
            git_output(
                &root,
                &[
                    "-c",
                    "core.quotepath=false",
                    "status",
                    "--porcelain=v1",
                    "--branch",
                ],
            )?,
        )?;
        let text = String::from_utf8_lossy(&output.stdout);
        let mut lines = text.lines();
        let branch = lines.next().and_then(branch_from_header);
        let upstream = optional_git_text(
            &root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        );
        let (ahead, behind) = upstream_distance(&root);
        let changes = lines
            .filter_map(|line| {
                if line.len() < 4 {
                    return None;
                }
                let index_status = line[0..1].to_string();
                let worktree_status = line[1..2].to_string();
                let raw_path = line[3..].to_string();
                let (original_path, path) = raw_path
                    .split_once(" -> ")
                    .map(|(from, to)| (Some(from.to_string()), to.to_string()))
                    .unwrap_or((None, raw_path));
                Some(GitChange {
                    path,
                    original_path,
                    index_status,
                    worktree_status,
                })
            })
            .collect();
        Ok(GitStatus {
            root: root.display().to_string(),
            branch,
            upstream,
            ahead,
            behind,
            is_repository: true,
            changes,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_file_diff(
    path: String,
    file_path: String,
    diff_mode: Option<String>,
    base_ref: Option<String>,
) -> Result<GitFileDiff, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        validated_file_paths(vec![file_path.clone()])?;
        let requested = root
            .join(&file_path)
            .canonicalize()
            .unwrap_or_else(|_| root.join(&file_path));
        if !requested.starts_with(&root) {
            return Err("文件不在当前工作区内".to_string());
        }
        let output = match diff_mode.as_deref() {
            Some("staged") => require_success(
                "读取暂存差异",
                git_output(
                    &root,
                    &["diff", "--cached", "--no-ext-diff", "--", &file_path],
                )?,
            )?,
            Some("unstaged") => require_success(
                "读取工作区差异",
                git_output(&root, &["diff", "--no-ext-diff", "--", &file_path])?,
            )?,
            // "Everything this turn changed" and "everything since the base
            // branch" are the two review scopes that matter more than the
            // index/worktree split, so both are first-class here.
            Some("range") => {
                let base = validated_git_ref(base_ref.as_deref())?;
                require_success(
                    "读取范围差异",
                    git_output(&root, &["diff", "--no-ext-diff", &base, "--", &file_path])?,
                )?
            }
            _ => require_success(
                "读取文件差异",
                git_output(&root, &["diff", "--no-ext-diff", "HEAD", "--", &file_path])?,
            )?,
        };
        Ok(GitFileDiff {
            path: file_path,
            diff: String::from_utf8_lossy(&output.stdout).to_string(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stage_git_files(
    path: String,
    file_paths: Vec<String>,
) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let file_paths = validated_file_paths(file_paths)?;
        let output = require_success(
            "暂存文件",
            git_output_with_paths(&root, &["add", "--all", "--"], &file_paths)?,
        )?;
        Ok(operation_result("已暂存所选文件", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stage_all_git(path: String) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let output = require_success("暂存全部改动", git_output(&root, &["add", "--all"])?)?;
        Ok(operation_result("已暂存全部改动", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn unstage_git_files(
    path: String,
    file_paths: Vec<String>,
) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let file_paths = validated_file_paths(file_paths)?;
        let output = if has_head(&root) {
            require_success(
                "取消暂存文件",
                git_output_with_paths(&root, &["reset", "--quiet", "HEAD", "--"], &file_paths)?,
            )?
        } else {
            require_success(
                "取消暂存文件",
                git_output_with_paths(
                    &root,
                    &["rm", "--cached", "-r", "--ignore-unmatch", "--"],
                    &file_paths,
                )?,
            )?
        };
        Ok(operation_result("已取消暂存所选文件", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn unstage_all_git(path: String) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let output = if has_head(&root) {
            require_success(
                "取消全部暂存",
                git_output(&root, &["reset", "--quiet", "HEAD", "--"])?,
            )?
        } else {
            require_success(
                "取消全部暂存",
                git_output(
                    &root,
                    &["rm", "--cached", "-r", "--ignore-unmatch", "--", "."],
                )?,
            )?
        };
        Ok(operation_result("已取消全部暂存", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pull_git(path: String) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        if optional_git_text(
            &root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .is_none()
        {
            return Err("当前分支未设置上游分支，暂时无法拉取。".to_string());
        }
        let output = require_success("拉取", git_output(&root, &["pull", "--ff-only"])?)?;
        crate::audit::ok("git.pull", serde_json::json!({ "root": root.display().to_string() }));
        Ok(operation_result("拉取完成", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn commit_git(path: String, message: String) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let message = message.trim();
        if message.is_empty() {
            return Err("请输入提交说明。".to_string());
        }
        if message.chars().count() > 500 {
            return Err("提交说明不能超过 500 个字符。".to_string());
        }
        let output = require_success(
            "提交",
            git_output(&root, &["commit", "--message", message])?,
        )?;
        crate::audit::ok(
            "git.commit",
            serde_json::json!({ "root": root.display().to_string(), "message": message }),
        );
        Ok(operation_result("提交完成", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn push_git(path: String) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let branch = optional_git_text(&root, &["branch", "--show-current"])
            .ok_or_else(|| "当前处于分离 HEAD 状态，无法直接推送。".to_string())?;
        let has_upstream = optional_git_text(
            &root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .is_some();
        let output = if has_upstream {
            require_success("推送", git_output(&root, &["push"])?)?
        } else {
            require_success(
                "读取 origin",
                git_output(&root, &["remote", "get-url", "origin"])?,
            )?;
            require_success(
                "推送",
                git_output(&root, &["push", "--set-upstream", "origin", &branch])?,
            )?
        };
        crate::audit::ok(
            "git.push",
            serde_json::json!({ "root": root.display().to_string(), "branch": branch }),
        );
        Ok(operation_result("推送完成", output))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Accept only a plain Git revision: it is interpolated into an argv slot that
/// also accepts options, so a value like `--output=x` must never get through.
fn validated_git_ref(value: Option<&str>) -> Result<String, String> {
    let value = value.map(str::trim).unwrap_or_default();
    if value.is_empty() {
        return Err("缺少比较基线。".to_string());
    }
    let rejected = ['~', '^', ':', '\\', '"', '\''];
    if value.len() > 200
        || value.starts_with('-')
        || value.contains(char::is_whitespace)
        || value.contains("..")
        || value.contains(rejected)
    {
        return Err(format!("无效的 Git 引用：{value}"));
    }
    Ok(value.to_string())
}

/// Local and remote branch names — the candidates for "compare with base
/// branch" in the review panel.
#[tauri::command]
pub async fn list_git_branches(path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        let mut names: Vec<String> = Vec::new();
        for scope in [
            ["branch", "--sort=-committerdate", "--format=%(refname:short)"],
            ["branch", "--remotes", "--format=%(refname:short)"],
        ] {
            if let Some(text) = optional_git_text(&root, &scope) {
                for line in text.lines() {
                    let name = line.trim();
                    if name.is_empty() || name.contains("HEAD ->") {
                        continue;
                    }
                    if !names.iter().any(|item| item == name) {
                        names.push(name.to_string());
                    }
                }
            }
        }
        Ok(names)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Snapshot the working tree as a dangling commit and return its id.
///
/// `git stash create` writes a commit object without touching the index, the
/// worktree, or the stash list, which makes it a safe marker for "what this
/// agent turn started from". A clean tree produces nothing, so HEAD is used.
#[tauri::command]
pub async fn create_git_snapshot(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        if !has_head(&root) {
            return Ok(String::new());
        }
        Ok(optional_git_text(&root, &["stash", "create"])
            .or_else(|| optional_git_text(&root, &["rev-parse", "HEAD"]))
            .unwrap_or_default())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Apply one hunk-sized patch produced by the review panel.
///
/// The patch is piped to `git apply` on stdin rather than written to a file,
/// and the `-R` / `--cached` combination decides whether this stages, unstages
/// or reverts the selected hunk.
#[tauri::command]
pub async fn apply_git_patch(
    path: String,
    patch: String,
    reverse: bool,
    cached: bool,
) -> Result<GitOperationResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = repository_root(path)?;
        if patch.trim().is_empty() {
            return Err("补丁内容为空。".to_string());
        }
        if patch.len() > 4_000_000 {
            return Err("补丁过大，请改用整文件操作。".to_string());
        }
        // No `--recount`: the hunk headers are copied verbatim from Git's own
        // diff output, and `--recount` actually rejects such patches when a
        // single hunk is lifted out of a multi-hunk file.
        let mut args = vec!["apply"];
        if cached {
            args.push("--cached");
        }
        if reverse {
            args.push("-R");
        }
        let output = require_success(
            if reverse { "撤销片段" } else { "应用片段" },
            git_stdin_output(&root, &args, &patch)?,
        )?;
        crate::audit::ok(
            "git.apply_patch",
            serde_json::json!({
                "root": root.display().to_string(),
                "reverse": reverse,
                "cached": cached,
                "bytes": patch.len(),
            }),
        );
        Ok(operation_result(
            if reverse { "已撤销所选片段" } else { "已应用所选片段" },
            output,
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn git_stdin_output(root: &Path, args: &[&str], stdin_text: &str) -> Result<Output, String> {
    use std::io::Write as _;
    use std::process::Stdio;

    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法运行 Git：{error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "无法向 Git 写入补丁".to_string())?
        .write_all(stdin_text.as_bytes())
        .map_err(|error| format!("写入补丁失败：{error}"))?;
    child
        .wait_with_output()
        .map_err(|error| format!("无法运行 Git：{error}"))
}

#[cfg(test)]
mod tests {
    use super::{branch_from_header, validated_file_paths, validated_git_ref};

    #[test]
    fn git_refs_cannot_smuggle_options_or_shell_metacharacters() {
        assert!(validated_git_ref(Some("main")).is_ok());
        assert!(validated_git_ref(Some("origin/main")).is_ok());
        assert!(validated_git_ref(Some("3f1a9c2")).is_ok());
        assert!(validated_git_ref(Some("--output=/tmp/x")).is_err());
        assert!(validated_git_ref(Some("main..HEAD")).is_err());
        assert!(validated_git_ref(Some("main; rm -rf /")).is_err());
        assert!(validated_git_ref(None).is_err());
    }

    #[test]
    fn parses_branch_headers_with_tracking_state() {
        assert_eq!(
            branch_from_header("## feature/git...origin/feature/git [ahead 2, behind 1]")
                .as_deref(),
            Some("feature/git")
        );
    }

    #[test]
    fn parses_branch_headers_before_the_first_commit() {
        assert_eq!(
            branch_from_header("## No commits yet on main").as_deref(),
            Some("main")
        );
    }

    #[test]
    fn rejects_git_paths_outside_the_workspace() {
        assert!(validated_file_paths(vec!["../outside.txt".to_string()]).is_err());
        assert!(validated_file_paths(vec!["src/main.rs".to_string()]).is_ok());
    }
}
