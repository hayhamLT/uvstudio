// UV Studio — desktop shell (Tauri v2).
//
// Wraps the exact same web frontend (../dist) and adds the Cinema 4D link-folder
// bridge as three commands the frontend calls via window.__TAURI__.core.invoke:
//
//   bridge_connect()                 -> Option<String>   (pick the shared folder)
//   bridge_send(bytes, objects)      -> Result<(), Err>  (write to_c4d/scene.glb)
//   bridge_poll()                    -> Option<Vec<u8>>  (new to_app/scene.glb)
//
// Folder protocol matches the C4D plugin and src/bridge/link.ts:
//   <link>/to_app/scene.glb + scene.json   C4D -> app   (we read)
//   <link>/to_c4d/scene.glb + scene.json   app -> C4D   (we write, manifest last)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;
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

#[tauri::command]
fn bridge_connect(app: tauri::AppHandle, state: State<Mutex<Bridge>>) -> Option<String> {
    let picked = app.dialog().file().blocking_pick_folder()?;
    let dir = picked.into_path().ok()?;
    let mut b = state.lock().unwrap();
    // seed last_ts from any existing inbox so we don't re-import a stale model
    b.last_ts = read_ts(&dir.join(TO_APP));
    let label = dir.to_string_lossy().to_string();
    b.dir = Some(dir);
    Some(label)
}

#[tauri::command]
fn bridge_send(state: State<Mutex<Bridge>>, bytes: Vec<u8>, screens: Vec<Screen>) -> Result<(), String> {
    let b = state.lock().map_err(|e| e.to_string())?;
    let dir = b.dir.clone().ok_or("no link folder")?;
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

/// Native Save dialog → write the GLB and a sidecar `<name>.json` next to it.
#[tauri::command]
fn export_glb(app: tauri::AppHandle, name: String, bytes: Vec<u8>, sidecar: String) -> Option<String> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("glTF binary", &["glb"])
        .blocking_save_file()?
        .into_path()
        .ok()?;
    fs::write(&path, &bytes).ok()?;
    // sidecar manifest alongside the GLB (same stem, .json)
    let json = path.with_extension("json");
    let _ = fs::write(&json, sidecar.as_bytes());
    Some(path.to_string_lossy().to_string())
}

/// Native Open dialog → return a picked GLB/glTF's bytes + file name.
#[tauri::command]
fn import_glb(app: tauri::AppHandle) -> Option<Picked> {
    let path = app
        .dialog()
        .file()
        .add_filter("glTF", &["glb", "gltf"])
        .blocking_pick_file()?
        .into_path()
        .ok()?;
    let bytes = fs::read(&path).ok()?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "model.glb".into());
    Some(Picked { name, bytes })
}

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Bridge::default()))
        .invoke_handler(tauri::generate_handler![
            bridge_connect,
            bridge_send,
            bridge_poll,
            export_glb,
            import_glb
        ])
        .run(tauri::generate_context!())
        .expect("error while running UV Studio");
}
