use tauri::{plugin::TauriPlugin, AppHandle, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn quick_add_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA)
}

fn is_quick_add_pressed(registered: &Shortcut, triggered: &Shortcut, state: ShortcutState) -> bool {
    registered == triggered && state == ShortcutState::Pressed
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let quick_add_shortcut = quick_add_shortcut();
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if is_quick_add_pressed(&quick_add_shortcut, shortcut, event.state) {
                crate::tray::show_quick_add(app);
            }
        })
        .build()
}

pub fn set_registered<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let shortcut = quick_add_shortcut();
    let global_shortcut = app.global_shortcut();
    if global_shortcut.is_registered(shortcut) == enabled {
        return Ok(());
    }
    if enabled {
        global_shortcut.register(shortcut)
    } else {
        global_shortcut.unregister(shortcut)
    }
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_registered_pressed_event_activates_quick_add() {
        let quick_add = quick_add_shortcut();
        let another: Shortcut = "Ctrl+Alt+B".parse().expect("valid shortcut");

        assert!(is_quick_add_pressed(
            &quick_add,
            &quick_add,
            ShortcutState::Pressed
        ));
        assert!(!is_quick_add_pressed(
            &quick_add,
            &quick_add,
            ShortcutState::Released
        ));
        assert!(!is_quick_add_pressed(
            &quick_add,
            &another,
            ShortcutState::Pressed
        ));
    }
}
