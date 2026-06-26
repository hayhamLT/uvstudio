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

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

const TO_APP: &str = "to_app";
const TO_C4D: &str = "to_c4d";
const GLB: &str = "scene.glb";
const MANIFEST: &str = "scene.json";

#[derive(Default)]
struct Bridge {
    dir: Option<PathBuf>,
    last_ts: Option<i64>,
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn read_ts(folder: &PathBuf) -> Option<i64> {
    let txt = fs::read_to_string(folder.join(MANIFEST)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    v.get("ts")?.as_i64()
}

/// Where we remember the chosen link folder (so it's picked once, ever).
fn config_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join("link_folder.txt"))
}

/// Pick the shared link folder (async → dialog won't freeze the UI).
#[tauri::command]
async fn bridge_connect(app: tauri::AppHandle, state: State<'_, Mutex<Bridge>>) -> Result<Option<String>, String> {
    let dir = match app.dialog().file().blocking_pick_folder().and_then(|fp| fp.into_path().ok()) {
        Some(p) => p,
        None => return Ok(None),
    };
    let label = dir.to_string_lossy().to_string();
    if let Some(cf) = config_file(&app) {
        let _ = fs::write(cf, label.as_bytes()); // remember for next launch
    }
    let mut b = state.lock().map_err(|e| e.to_string())?;
    b.last_ts = read_ts(&dir.join(TO_APP)); // seed so we don't re-import a stale model
    b.dir = Some(dir);
    Ok(Some(label))
}

/// Return the remembered link folder (loaded at startup), if any.
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

/// Poll to_app/ for a model sent from C4D (sync: frequent + cheap, no dialog).
#[tauri::command]
fn bridge_poll(state: State<Mutex<Bridge>>) -> Option<Vec<u8>> {
    let mut b = state.lock().ok()?;
    let dir = b.dir.clone()?;
    let inbox = dir.join(TO_APP);
    let ts = read_ts(&inbox)?;
    if Some(ts) == b.last_ts {
        return None; // nothing new
    }
    b.last_ts = Some(ts);
    fs::read(inbox.join(GLB)).ok()
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

/// Copy the bundled C4D plugin into a `plugins` folder the user picks.
#[tauri::command]
async fn install_c4d_plugin(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dest = match app.dialog().file().blocking_pick_folder().and_then(|fp| fp.into_path().ok()) {
        Some(p) => p,
        None => return Ok(None),
    };
    // bundled plugin files (see tauri.conf → bundle.resources)
    let src = app.path().resolve("c4d-plugin", BaseDirectory::Resource).map_err(|e| e.to_string())?;
    let target = dest.join("UVStudioBridge");
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let mut n = 0;
    for entry in fs::read_dir(&src).map_err(|e| format!("plugin files not found: {e}"))? {
        let p = entry.map_err(|e| e.to_string())?.path();
        if p.is_file() {
            if let Some(fname) = p.file_name() {
                fs::copy(&p, target.join(fname)).map_err(|e| e.to_string())?;
                n += 1;
            }
        }
    }
    Ok(Some(format!("{} ({} files)", target.to_string_lossy(), n)))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Bridge::default()))
        .setup(|app| {
            // reload a previously-chosen link folder so it's "set once, ever"
            let handle = app.handle().clone();
            let saved = config_file(&handle)
                .and_then(|cf| fs::read_to_string(cf).ok())
                .map(|s| PathBuf::from(s.trim()))
                .filter(|d| d.is_dir());
            if let Some(dir) = saved {
                let state = handle.state::<Mutex<Bridge>>();
                let mut b = state.lock().expect("bridge state lock");
                b.last_ts = read_ts(&dir.join(TO_APP));
                b.dir = Some(dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge_connect,
            bridge_restore,
            bridge_send,
            bridge_send_uvs,
            bridge_poll,
            export_glb,
            import_glb,
            install_c4d_plugin
        ])
        .run(tauri::generate_context!())
        .expect("error while running UV Studio");
}
