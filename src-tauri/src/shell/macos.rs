//! Dock Quit invokes AppKit directly rather than Tauri's ExitRequested event.
//! Add only the optional termination delegate method; Tao keeps ownership of
//! the delegate and all its existing launch, reopen and teardown callbacks.
use std::{
    ffi::{c_char, c_void},
    sync::{atomic::Ordering, OnceLock},
};
use tauri::{AppHandle, Manager};

type Id = *mut c_void;
type Sel = *mut c_void;
static APP: OnceLock<AppHandle> = OnceLock::new();

#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn object_getClass(object: Id) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
    fn class_addMethod(
        class: Id,
        selector: Sel,
        implementation: *const c_void,
        types: *const c_char,
    ) -> i8;
}

unsafe fn send0<R>(object: Id, selector: &std::ffi::CStr) -> R {
    let method: unsafe extern "C" fn(Id, Sel) -> R =
        unsafe { std::mem::transmute_copy(&(objc_msgSend as *const ())) };
    unsafe { method(object, sel_registerName(selector.as_ptr())) }
}

unsafe fn quit_reason() -> i32 {
    // AppKit supplies kAEQuitReason ('why?') for logout, shutdown, restart and
    // Quit All. Let those requests terminate normally rather than block them.
    let manager = unsafe { objc_getClass(c"NSAppleEventManager".as_ptr()) };
    let manager: Id = unsafe { send0(manager, c"sharedAppleEventManager") };
    let event: Id = unsafe { send0(manager, c"currentAppleEvent") };
    if event.is_null() {
        return 0;
    }
    let method: unsafe extern "C" fn(Id, Sel, u32) -> Id =
        unsafe { std::mem::transmute_copy(&(objc_msgSend as *const ())) };
    let mut reason = unsafe {
        method(
            event,
            sel_registerName(c"attributeDescriptorForKeyword:".as_ptr()),
            u32::from_be_bytes(*b"why?"),
        )
    };
    if reason.is_null() {
        reason = unsafe {
            method(
                event,
                sel_registerName(c"paramDescriptorForKeyword:".as_ptr()),
                u32::from_be_bytes(*b"why?"),
            )
        };
    }
    if reason.is_null() {
        0
    } else {
        unsafe { send0(reason, c"int32Value") }
    }
}

extern "C" fn should_terminate(_delegate: Id, _selector: Sel, _application: Id) -> usize {
    // NSApplicationTerminateReply is NSUInteger on the supported 64-bit Macs:
    // NSTerminateCancel = 0, NSTerminateNow = 1.
    let Some(app) = APP.get() else { return 1 };
    let quitting = app
        .try_state::<super::ShellState>()
        .map(|state| state.quitting.load(Ordering::Acquire))
        .unwrap_or(false);
    let reopen_available =
        app.tray_by_id(super::TRAY_ID).is_some() && app.get_webview_window("main").is_some();
    if unsafe { quit_reason() } != 0
        || !super::should_keep_in_tray(None, quitting, reopen_available)
    {
        return 1;
    }
    super::hide_to_tray(app);
    0
}

pub(super) fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Called from Tauri setup on the main thread, after Tao created its delegate.
    unsafe {
        let application: Id = send0(
            objc_getClass(c"NSApplication".as_ptr()),
            c"sharedApplication",
        );
        let delegate: Id = send0(application, c"delegate");
        if delegate.is_null() {
            return Err("无法设置 Dock 退出行为：应用委托不可用。".into());
        }
        APP.set(app.clone()).map_err(|_| "Dock 退出行为已设置。")?;
        if class_addMethod(
            object_getClass(delegate),
            sel_registerName(c"applicationShouldTerminate:".as_ptr()),
            should_terminate as *const c_void,
            c"Q@:@".as_ptr(),
        ) == 0
        {
            return Err("无法设置 Dock 退出行为：应用委托方法冲突。".into());
        }
    }
    Ok(())
}

#[cfg(debug_assertions)]
pub(super) fn smoke_quit() {
    // Exercise the same AppKit entrypoint used by the Dock. A broken hook
    // terminates the test process before it can produce a passing report.
    unsafe {
        let application: Id = send0(
            objc_getClass(c"NSApplication".as_ptr()),
            c"sharedApplication",
        );
        let method: unsafe extern "C" fn(Id, Sel, Id) =
            std::mem::transmute_copy(&(objc_msgSend as *const ()));
        method(
            application,
            sel_registerName(c"terminate:".as_ptr()),
            std::ptr::null_mut(),
        );
    }
}

#[cfg(debug_assertions)]
pub(super) fn dock_visible() -> bool {
    unsafe {
        let application: Id = send0(
            objc_getClass(c"NSApplication".as_ptr()),
            c"sharedApplication",
        );
        send0::<isize>(application, c"activationPolicy") == 0
    }
}
