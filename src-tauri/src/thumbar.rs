// Windows 任务栏缩略图工具栏按钮（上一首 / 播放暂停 / 下一首 / 喜欢）。
//
// 通过 ITaskbarList3::ThumbBarAddButtons 添加按钮，并用 SetWindowSubclass 子类化主窗口
// 以捕获 WM_COMMAND/THBN_CLICKED 点击，转成与托盘/快捷键一致的 Tauri 事件：
//   playPrev / toggle / playNext / thumbar:toggle-like
// 非 Windows 平台为 no-op。

use tauri::AppHandle;

#[cfg(windows)]
mod imp {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use tauri::{Emitter, Manager};
    use windows::core::IUnknown;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED,
        THBF_ENABLED, THB_FLAGS, THB_ICON, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, HICON, IMAGE_FLAGS, WM_COMMAND,
    };

    const THBN_CLICKED: u32 = 0x1800;
    const SUBCLASS_ID: usize = 0x0000_CEA0;

    #[derive(Clone, Copy)]
    pub struct State {
        pub has_song: bool,
        pub is_playing: bool,
        pub is_liked: bool,
    }

    static STATE: Mutex<State> = Mutex::new(State {
        has_song: false,
        is_playing: false,
        is_liked: false,
    });

    struct Icons {
        prev: HICON,
        play: HICON,
        pause: HICON,
        next: HICON,
        like: HICON,
        liked: HICON,
    }
    unsafe impl Send for Icons {}
    unsafe impl Sync for Icons {}
    static ICONS: OnceLock<Icons> = OnceLock::new();

    struct Bar {
        taskbar: ITaskbarList3,
        hwnd: HWND,
        added: bool,
    }
    unsafe impl Send for Bar {}
    static BAR: Mutex<Option<Bar>> = Mutex::new(None);

    fn load_icon(bytes: &[u8]) -> HICON {
        unsafe {
            CreateIconFromResourceEx(bytes, true, 0x0003_0000, 32, 32, IMAGE_FLAGS(0))
                .unwrap_or_default()
        }
    }

    fn icons() -> &'static Icons {
        ICONS.get_or_init(|| Icons {
            prev: load_icon(include_bytes!("../icons/thumbar/prev.png")),
            play: load_icon(include_bytes!("../icons/thumbar/play.png")),
            pause: load_icon(include_bytes!("../icons/thumbar/pause.png")),
            next: load_icon(include_bytes!("../icons/thumbar/next.png")),
            like: load_icon(include_bytes!("../icons/thumbar/like.png")),
            liked: load_icon(include_bytes!("../icons/thumbar/liked.png")),
        })
    }

    fn make_button(id: u32, icon: HICON, enabled: bool) -> THUMBBUTTON {
        let mut b: THUMBBUTTON = unsafe { std::mem::zeroed() };
        b.dwMask = THB_ICON | THB_FLAGS;
        b.iId = id;
        b.hIcon = icon;
        b.dwFlags = if enabled { THBF_ENABLED } else { THBF_DISABLED };
        b
    }

    fn buttons(st: &State) -> [THUMBBUTTON; 4] {
        let ic = icons();
        [
            make_button(0, ic.prev, st.has_song),
            make_button(
                1,
                if st.is_playing { ic.pause } else { ic.play },
                st.has_song,
            ),
            make_button(2, ic.next, st.has_song),
            make_button(3, if st.is_liked { ic.liked } else { ic.like }, st.has_song),
        ]
    }

    fn get_hwnd(app: &AppHandle) -> Option<HWND> {
        app.get_webview_window("main")?.hwnd().ok()
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        refdata: usize,
    ) -> LRESULT {
        if msg == WM_COMMAND {
            let hi = ((wparam.0 >> 16) & 0xffff) as u32;
            if hi == THBN_CLICKED && refdata != 0 {
                let id = (wparam.0 & 0xffff) as u32;
                let app = &*(refdata as *const AppHandle);
                let ev = match id {
                    0 => "playPrev",
                    1 => "toggle",
                    2 => "playNext",
                    3 => "thumbar:toggle-like",
                    _ => "",
                };
                if !ev.is_empty() {
                    let _ = app.emit(ev, ());
                }
            }
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    fn apply(app: &AppHandle) {
        let hwnd = match get_hwnd(app) {
            Some(h) => h,
            None => return,
        };
        let st = *STATE.lock().unwrap();
        let mut guard = BAR.lock().unwrap();

        if guard.is_none() {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }
            match unsafe {
                CoCreateInstance::<Option<&IUnknown>, ITaskbarList3>(
                    &TaskbarList,
                    None,
                    CLSCTX_INPROC_SERVER,
                )
            } {
                Ok(tb) => {
                    unsafe {
                        let _ = tb.HrInit();
                    }
                    *guard = Some(Bar {
                        taskbar: tb,
                        hwnd,
                        added: false,
                    });
                }
                Err(_) => return,
            }
        }

        if let Some(bar) = guard.as_mut() {
            let btns = buttons(&st);
            unsafe {
                if !bar.added {
                    if bar.taskbar.ThumbBarAddButtons(bar.hwnd, &btns).is_ok() {
                        bar.added = true;
                        let boxed = Box::into_raw(Box::new(app.clone()));
                        let _ = SetWindowSubclass(
                            bar.hwnd,
                            Some(subclass_proc),
                            SUBCLASS_ID,
                            boxed as usize,
                        );
                    }
                } else {
                    let _ = bar.taskbar.ThumbBarUpdateButtons(bar.hwnd, &btns);
                }
            }
        }
    }

    pub fn set_state(app: &AppHandle, has_song: bool, is_playing: bool, is_liked: bool) {
        *STATE.lock().unwrap() = State {
            has_song,
            is_playing,
            is_liked,
        };
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || apply(&app2));
    }
}

#[tauri::command]
pub fn thumbar_set_state(app: AppHandle, state: serde_json::Value) {
    #[cfg(windows)]
    {
        let has_song = state
            .get("hasSong")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_playing = state
            .get("isPlaying")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_liked = state
            .get("isLiked")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        imp::set_state(&app, has_song, is_playing, is_liked);
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
    }
}

#[tauri::command]
pub fn thumbar_set_cover(app: AppHandle, cover: Option<String>) {
    // 任务栏实时缩略图（封面）为可选增强项，暂未实现；接收参数以兼容前端调用。
    let _ = (app, cover);
}
