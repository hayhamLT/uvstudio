// UV Studio — desktop shell (Tauri v2).
//
// Wraps the same web frontend (../dist) and adds the Cinema 4D link-folder bridge
// + a one-click plugin installer, as commands the frontend invokes.
//
// IMPORTANT: every command that opens a native dialog is `async`. Plain (sync)
// commands run on the MAIN UI thread, and a blocking dialog there freezes the
// window; async commands run off the main thread, so the dialog is safe.
//
// Folder protocol (matches the C4D plugin + src/bridge/link.ts):
//   <link>/to_app/scene.glb + scene.json   C4D -> app   (we read)
//   <link>/to_c4d/scene.glb + scene.json   app -> C4D   (we write, manifest last)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const TO_APP: &str = "to_app";
const TO_C4D: &str = "to_c4d";
const GLB: &str = "scene.glb";
const MANIFEST: &str = "scene.json";
const ACK: &str = "ack.json";

#[derive(Default)]
struct Bridge {
    dir: Option<PathBuf>,
    last_ts: Option<i64>,
    last_ack_ts: Option<i64>,
}

#[derive(Deserialize, Serialize, Clone)]
struct Screen {
    name: String,
    w: f64,
    h: f64,
    aspect: f64,
}

#[derive(Serialize)]
struct Manifest {
    v: u32,
    ts: i64,
    objects: Vec<String>,
    screens: Vec<Screen>,
}

#[derive(Serialize)]
struct Picked {
    name: String,
    bytes: Vec<u8>,
}

/// What bridge_poll hands the app: the new scene.json (forward sidecar or legacy
/// manifest) plus scene.glb bytes if present.
#[derive(Serialize)]
struct Poll {
    json: String,
    glb: Option<Vec<u8>>,
}

/// The zero-config shared bridge folder: a fixed name inside the OS per-user temp
/// dir. The C4D plugin computes the SAME path (Python's tempfile.gettempdir() and
/// Rust's env::temp_dir() resolve to the same per-user location), so the two link
/// up with nothing to pick. Created (incl. both subfolders) on demand.
fn default_link_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("UVStudioBridge");
    let _ = fs::create_dir_all(dir.join(TO_APP));
    let _ = fs::create_dir_all(dir.join(TO_C4D));
    dir
}

/// Pointer the app writes when the user picks a CUSTOM link folder. It lives at
/// the FIXED temp location so the C4D plugin (which defaults there) reads it and
/// follows the app to the same custom folder — keeping both ends in sync. Absent
/// = use the temp default.
fn link_pointer() -> PathBuf {
    std::env::temp_dir().join("UVStudioBridge").join("linkdir.txt")
}

/// The active link folder: the custom one named by the pointer (if it resolves),
/// otherwise the temp default. Ensures both subfolders exist either way.
fn resolve_link_dir() -> PathBuf {
    if let Ok(p) = fs::read_to_string(link_pointer()) {
        let p = p.trim();
        if !p.is_empty() {
            let dir = PathBuf::from(p);
            if fs::create_dir_all(dir.join(TO_APP)).is_ok()
                && fs::create_dir_all(dir.join(TO_C4D)).is_ok()
            {
                return dir;
            }
        }
    }
    default_link_dir()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_ts_at(path: &PathBuf) -> Option<i64> {
    let txt = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    v.get("ts")?.as_i64()
}

fn read_ts(folder: &PathBuf) -> Option<i64> {
    read_ts_at(&folder.join(MANIFEST))
}

/// Watch the to_app/ inbox and push a `bridge-changed` event the instant C4D
/// drops anything there — so the app reacts immediately instead of waiting for
/// the next poll. The fallback poll on the frontend covers any missed event.
fn start_watcher(app: tauri::AppHandle, dir: PathBuf) {
    std::thread::spawn(move || {
        let inbox = dir.join(TO_APP);
        let _ = fs::create_dir_all(&inbox);
        let mut watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = app.emit("bridge-changed", ());
            }
        }) {
            Ok(w) => w,
            Err(_) => return,
        };
        if watcher.watch(&inbox, RecursiveMode::NonRecursive).is_err() {
            return;
        }
        // hold the watcher alive for the life of the process
        loop {
            std::thread::park();
        }
    });
}

/// Pick a CUSTOM shared link folder (async → dialog won't freeze the UI). Writes
/// the shared pointer so the C4D plugin follows us to the same folder.
#[tauri::command]
async fn bridge_connect(app: tauri::AppHandle, state: State<'_, Mutex<Bridge>>) -> Result<Option<String>, String> {
    let dir = match app.dialog().file().blocking_pick_folder().and_then(|fp| fp.into_path().ok()) {
        Some(p) => p,
        None => return Ok(None),
    };
    // make the bridge subfolders in the chosen folder
    let _ = fs::create_dir_all(dir.join(TO_APP));
    let _ = fs::create_dir_all(dir.join(TO_C4D));
    // point both ends here: the plugin reads this pointer from the temp default
    let ptr = link_pointer();
    if let Some(parent) = ptr.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&ptr, dir.to_string_lossy().as_bytes());
    let label = dir.to_string_lossy().to_string();
    let mut b = state.lock().map_err(|e| e.to_string())?;
    b.last_ts = read_ts(&dir.join(TO_APP)); // seed so we don't re-import a stale model
    b.dir = Some(dir);
    Ok(Some(label))
}

/// Switch back to the zero-config temp folder: drop the custom pointer so both
/// ends fall back to the shared default.
#[tauri::command]
fn bridge_use_default(state: State<Mutex<Bridge>>) -> Result<String, String> {
    let _ = fs::remove_file(link_pointer());
    let dir = default_link_dir();
    let mut b = state.lock().map_err(|e| e.to_string())?;
    b.last_ts = read_ts(&dir.join(TO_APP));
    let label = dir.to_string_lossy().to_string();
    b.dir = Some(dir);
    Ok(label)
}

/// True when a custom link folder is set (the pointer file exists).
#[tauri::command]
fn bridge_is_custom() -> bool {
    link_pointer().is_file()
}

/// Return the active link folder, if any.
#[tauri::command]
fn bridge_restore(state: State<Mutex<Bridge>>) -> Option<String> {
    let b = state.lock().ok()?;
    b.dir.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn bridge_send(state: State<'_, Mutex<Bridge>>, bytes: Vec<u8>, screens: Vec<Screen>) -> Result<(), String> {
    let dir = {
        let b = state.lock().map_err(|e| e.to_string())?;
        b.dir.clone().ok_or("no link folder")?
    };
    let out = dir.join(TO_C4D);
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;

    // GLB first (atomic via temp + rename), manifest LAST so readers see it ready
    let glb_tmp = out.join("scene.glb.tmp");
    fs::write(&glb_tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&glb_tmp, out.join(GLB)).map_err(|e| e.to_string())?;

    let objects = screens.iter().map(|s| s.name.clone()).collect();
    let man = Manifest { v: 1, ts: now_ms(), objects, screens };
    let man_tmp = out.join("scene.json.tmp");
    fs::write(&man_tmp, serde_json::to_vec(&man).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&man_tmp, out.join(MANIFEST)).map_err(|e| e.to_string())?;
    Ok(())
}

/// LOSSLESS return: write a UV-only JSON payload to to_c4d/scene.json (atomic via
/// temp + rename). No geometry — the plugin applies these UVs onto C4D's objects.
#[tauri::command]
async fn bridge_send_uvs(state: State<'_, Mutex<Bridge>>, json: String) -> Result<(), String> {
    let dir = {
        let b = state.lock().map_err(|e| e.to_string())?;
        b.dir.clone().ok_or("no link folder")?
    };
    let out = dir.join(TO_C4D);
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let tmp = out.join("scene.json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, out.join(MANIFEST)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Poll to_app/ for geometry sent from C4D (sync: frequent + cheap, no dialog).
/// Returns the new scene.json (forward sidecar) + scene.glb bytes if present.
#[tauri::command]
fn bridge_poll(state: State<Mutex<Bridge>>) -> Option<Poll> {
    let mut b = state.lock().ok()?;
    let dir = b.dir.clone()?;
    let inbox = dir.join(TO_APP);
    let ts = read_ts(&inbox)?;
    if Some(ts) == b.last_ts {
        return None; // nothing new
    }
    b.last_ts = Some(ts);
    let json = fs::read_to_string(inbox.join(MANIFEST)).ok()?;
    let glb = fs::read(inbox.join(GLB)).ok();
    Some(Poll { json, glb })
}

/// Read C4D's apply-ack (to_app/ack.json), deduped by ts — returns the JSON once
/// per new ack so the app can confirm "Cinema 4D applied UVs to N objects".
#[tauri::command]
fn bridge_ack(state: State<Mutex<Bridge>>) -> Option<String> {
    let mut b = state.lock().ok()?;
    let dir = b.dir.clone()?;
    let path = dir.join(TO_APP).join(ACK);
    let ts = read_ts_at(&path)?;
    if Some(ts) == b.last_ack_ts {
        return None; // already reported
    }
    b.last_ack_ts = Some(ts);
    fs::read_to_string(&path).ok()
}

/// Native Save dialog → write the GLB + a sidecar `<name>.json` next to it.
#[tauri::command]
async fn export_glb(app: tauri::AppHandle, name: String, bytes: Vec<u8>, sidecar: String) -> Result<Option<String>, String> {
    let path = match app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("glTF binary", &["glb"])
        .blocking_save_file()
        .and_then(|fp| fp.into_path().ok())
    {
        Some(p) => p,
        None => return Ok(None),
    };
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let _ = fs::write(path.with_extension("json"), sidecar.as_bytes());
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Native Open dialog → return a picked GLB/glTF's bytes + file name.
#[tauri::command]
async fn import_glb(app: tauri::AppHandle) -> Result<Option<Picked>, String> {
    let path = match app
        .dialog()
        .file()
        .add_filter("glTF", &["glb", "gltf"])
        .blocking_pick_file()
        .and_then(|fp| fp.into_path().ok())
    {
        Some(p) => p,
        None => return Ok(None),
    };
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "model.glb".into());
    Ok(Some(Picked { name, bytes }))
}

/// Copy the bundled plugin files into <plugins_dir>/UVStudioBridge/. Returns the
/// install path. Overwrites in place so re-installing always lands the latest.
fn copy_plugin_into(src: &Path, plugins_dir: &Path) -> Result<PathBuf, String> {
    let target = plugins_dir.join("UVStudioBridge");
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| format!("plugin files not found: {e}"))? {
        let p = entry.map_err(|e| e.to_string())?.path();
        if p.is_file() {
            if let Some(fname) = p.file_name() {
                fs::copy(&p, target.join(fname)).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(target)
}

/// Auto-find Cinema 4D user plugin folders — `<prefs>/Maxon Cinema 4D <ver>_<id>/
/// plugins` — which are writable without admin. Deduped across the case-insensitive
/// Maxon/MAXON roots (and the Windows %APPDATA% equivalent). Newest-used first.
fn collect_c4d_plugin_dirs() -> Vec<(u32, SystemTime, PathBuf)> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(h) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(h.join("Library/Preferences/Maxon"));
        roots.push(h.join("Library/Preferences/MAXON"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("Maxon"));
    } else if let Some(up) = std::env::var_os("USERPROFILE") {
        // fallback if %APPDATA% isn't set: the Roaming prefs live here on Windows
        roots.push(PathBuf::from(up).join("AppData").join("Roaming").join("Maxon"));
    }
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut found: Vec<(u32, SystemTime, PathBuf)> = Vec::new();
    for root in roots {
        let rd = match fs::read_dir(&root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let dir = e.path();
            if !dir.is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().contains("cinema 4d") {
                continue; // skip App Manager, Autograph, caches, etc.
            }
            // canonicalize the (existing) version dir so Maxon/MAXON collapse to one
            // (macOS case-insensitive roots). On Windows canonicalize yields a
            // \\?\ verbatim path, so skip it there — the dir is already unique.
            let canon = if cfg!(windows) {
                dir.clone()
            } else {
                fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone())
            };
            let plugins = canon.join("plugins");
            if !seen.insert(plugins.clone()) {
                continue;
            }
            let mtime = fs::metadata(&dir).and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH);
            found.push((c4d_version_key(&name), mtime, plugins));
        }
    }
    // newest version first, then most-recently-used among equal versions
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    found
}

/// Just the plugin dirs, newest version + most-recently-used first.
fn find_c4d_plugin_dirs() -> Vec<PathBuf> {
    collect_c4d_plugin_dirs().into_iter().map(|(_, _, p)| p).collect()
}

/// ALL prefs-config plugin dirs for the NEWEST installed version. Cinema 4D can
/// keep several config folders per version (…_9D810372, …_p, …_x, …_w); only one
/// is live, and we can't tell which from outside — so install into EVERY config
/// of that version. That guarantees the plugin loads whichever config C4D opens,
/// while still not touching older versions.
fn latest_version_plugin_dirs() -> Vec<PathBuf> {
    let all = collect_c4d_plugin_dirs();
    let top = match all.first() {
        Some(x) => x.0,
        None => return Vec::new(),
    };
    all.into_iter().filter(|x| x.0 == top).map(|(_, _, p)| p).collect()
}

/// Sortable version from a prefs folder name like "Maxon Cinema 4D 2026_9D810372"
/// → 2026. Year-numbered releases compare directly; anything else sorts as 0.
fn c4d_version_key(name: &str) -> u32 {
    let lower = name.to_lowercase();
    let after = lower.split("cinema 4d").nth(1).unwrap_or("");
    let digits: String = after
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().unwrap_or(0)
}

/// Install the bundled C4D plugin automatically into every detected Cinema 4D
/// user plugin folder. Returns the install paths, or None if no C4D was found
/// (the caller then falls back to the manual picker).
#[tauri::command]
async fn install_c4d_plugin_auto(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    let src = app.path().resolve("c4d-plugin", BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let mut installed = Vec::new();
    for dir in find_c4d_plugin_dirs() {
        if let Ok(target) = copy_plugin_into(&src, &dir) {
            installed.push(target.to_string_lossy().to_string());
        }
    }
    if installed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(installed))
    }
}

/// Install the bundled C4D plugin into EVERY config folder of the newest Cinema
/// 4D version (so it loads whichever config C4D opens). Used for the version-
/// driven refresh and the Install button. Returns the live (most-recently-used)
/// install path, or None if no C4D was found.
#[tauri::command]
async fn install_c4d_plugin_latest(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let src = app.path().resolve("c4d-plugin", BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let dirs = latest_version_plugin_dirs();
    if dirs.is_empty() {
        return Ok(None);
    }
    let mut live = None; // dirs are sorted most-recently-used first
    for dir in &dirs {
        let target = copy_plugin_into(&src, dir)?;
        if live.is_none() {
            live = Some(target.to_string_lossy().to_string());
        }
    }
    Ok(live)
}

/// Whether the bundled C4D plugin is already installed in the latest Cinema 4D.
#[derive(Serialize)]
struct C4dStatus {
    found: bool,        // any Cinema 4D detected
    installed: bool,    // the plugin file exists in the latest one
    path: Option<String>,
    version: Option<String>, // PLUGIN_VERSION of the installed .pyp (to flag stale)
}

/// Read PLUGIN_VERSION = "x.y.z" out of an installed plugin file.
fn read_plugin_version(p: &PathBuf) -> Option<String> {
    let txt = fs::read_to_string(p).ok()?;
    for line in txt.lines() {
        let t = line.trim_start();
        if t.starts_with("PLUGIN_VERSION") {
            let q1 = t.find('"')?;
            let q2 = t[q1 + 1..].find('"')?;
            return Some(t[q1 + 1..q1 + 1 + q2].to_string());
        }
    }
    None
}

#[tauri::command]
fn c4d_status() -> C4dStatus {
    match find_c4d_plugin_dirs().into_iter().next() {
        Some(dir) => {
            let pyp = dir.join("UVStudioBridge").join("UVStudioBridge.pyp");
            let installed = pyp.is_file();
            C4dStatus {
                found: true,
                installed,
                path: Some(dir.join("UVStudioBridge").to_string_lossy().to_string()),
                version: if installed { read_plugin_version(&pyp) } else { None },
            }
        }
        None => C4dStatus { found: false, installed: false, path: None, version: None },
    }
}

/// Open a URL in the user's default browser (used to start an update download).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let spawned = std::process::Command::new("xdg-open").arg(&url).spawn();
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

/// Quit the app (after kicking off an update download).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Bring Cinema 4D to the front after a send-back, so the result is visible
/// (the app drops behind). macOS activates C4D by its stable bundle id.
#[tauri::command]
fn focus_c4d(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").args(["-b", "net.maxon.cinema4d"]).spawn();
        let _ = &app; // C4D becomes frontmost; our window naturally drops behind
    }
    #[cfg(not(target_os = "macos"))]
    {
        // best-effort elsewhere: just minimize our window so C4D shows
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.minimize();
        }
    }
}

/// Bring the main window to the front (used when C4D sends new geometry).
#[tauri::command]
fn focus_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Resolve whatever folder the user picked to the actual C4D `plugins` folder, so
/// the plugin always lands somewhere C4D scans — even if they pick the wrong level:
///   * already a `plugins` folder            → use it
///   * a folder that CONTAINS a `plugins` dir → use that subfolder (they picked the
///     C4D config/install root)
///   * otherwise                             → install where they pointed
fn resolve_plugins_dir(picked: &Path) -> PathBuf {
    if picked.file_name().map_or(false, |n| n.to_string_lossy().eq_ignore_ascii_case("plugins")) {
        return picked.to_path_buf();
    }
    let sub = picked.join("plugins");
    if sub.is_dir() {
        return sub;
    }
    picked.to_path_buf()
}

/// Manual fallback / re-route: copy the bundled C4D plugin into a folder the user
/// picks. Tolerant of picking the config root vs its `plugins` subfolder.
#[tauri::command]
async fn install_c4d_plugin(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dest = match app.dialog().file().blocking_pick_folder().and_then(|fp| fp.into_path().ok()) {
        Some(p) => p,
        None => return Ok(None),
    };
    let plugins = resolve_plugins_dir(&dest);
    let src = app.path().resolve("c4d-plugin", BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let target = copy_plugin_into(&src, &plugins)?;
    Ok(Some(target.to_string_lossy().to_string()))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Bridge::default()))
        .setup(|app| {
            // Link folder defaults to the shared temp folder the C4D plugin also
            // computes — zero-config, "just works". If the user picked a CUSTOM
            // folder, a pointer (linkdir.txt in the temp default) names it and the
            // plugin reads the same pointer, so both ends stay in sync.
            let handle = app.handle().clone();
            let dir = resolve_link_dir();
            {
                let state = handle.state::<Mutex<Bridge>>();
                let mut b = state.lock().expect("bridge state lock");
                // If C4D *just* sent a scene (Send launches the app), DON'T seed
                // last_ts so we import it on launch. Otherwise seed it so we don't
                // re-import a stale model on every normal launch.
                let pending = read_ts(&dir.join(TO_APP));
                let fresh = pending.map_or(false, |t| now_ms() - t < 60_000);
                b.last_ts = if fresh { None } else { pending };
                b.last_ack_ts = read_ts_at(&dir.join(TO_APP).join(ACK)); // don't replay an old ack
                b.dir = Some(dir.clone());
            }
            start_watcher(app.handle().clone(), dir); // instant push on inbox changes
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge_connect,
            bridge_use_default,
            bridge_is_custom,
            bridge_restore,
            bridge_send,
            bridge_send_uvs,
            bridge_poll,
            bridge_ack,
            export_glb,
            import_glb,
            install_c4d_plugin,
            install_c4d_plugin_auto,
            install_c4d_plugin_latest,
            c4d_status,
            open_url,
            quit_app,
            focus_window,
            focus_c4d
        ])
        .run(tauri::generate_context!())
        .expect("error while running UV Studio");
}
