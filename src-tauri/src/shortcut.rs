use tauri::{plugin::TauriPlugin, AppHandle, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn quick_add_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA)
}

fn is_quick_add_pressed(registered: &Shortcut, triggered: &Shortcut, state: ShortcutState) -> bool {
    registered == triggered && state == ShortcutState::Pressed
}

#[derive(Debug, PartialEq, Eq)]
enum RegistrationChange {
    None,
    Register,
    Unregister,
}

fn registration_change(current: bool, enabled: bool) -> RegistrationChange {
    match (current, enabled) {
        (false, true) => RegistrationChange::Register,
        (true, false) => RegistrationChange::Unregister,
        _ => RegistrationChange::None,
    }
}

fn apply_registration_change<E>(
    change: RegistrationChange,
    register: impl FnOnce() -> Result<(), E>,
    unregister: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    match change {
        RegistrationChange::None => Ok(()),
        RegistrationChange::Register => register(),
        RegistrationChange::Unregister => unregister(),
    }
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
    apply_registration_change(
        registration_change(global_shortcut.is_registered(shortcut), enabled),
        || global_shortcut.register(shortcut),
        || global_shortcut.unregister(shortcut),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

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

    #[test]
    fn registration_changes_are_idempotent_and_propagate_native_errors() {
        assert_eq!(registration_change(false, false), RegistrationChange::None);
        assert_eq!(registration_change(true, true), RegistrationChange::None);
        assert_eq!(
            registration_change(false, true),
            RegistrationChange::Register
        );
        assert_eq!(
            registration_change(true, false),
            RegistrationChange::Unregister
        );

        let calls = Cell::new(0);
        apply_registration_change(
            RegistrationChange::None,
            || {
                calls.set(calls.get() + 1);
                Ok::<(), &str>(())
            },
            || {
                calls.set(calls.get() + 1);
                Ok(())
            },
        )
        .expect("an unchanged registration is a no-op");
        assert_eq!(calls.get(), 0);

        let action = Cell::new("none");
        apply_registration_change(
            RegistrationChange::Register,
            || {
                action.set("register");
                Ok::<(), &str>(())
            },
            || {
                action.set("unregister");
                Ok(())
            },
        )
        .expect("registration succeeds");
        assert_eq!(action.get(), "register");

        let register_error = apply_registration_change(
            RegistrationChange::Register,
            || Err("native register failed"),
            || Ok::<(), &str>(()),
        )
        .expect_err("register errors must reach the caller");
        assert_eq!(register_error, "native register failed");

        let error = apply_registration_change(
            RegistrationChange::Unregister,
            || Ok::<(), &str>(()),
            || Err("native unregister failed"),
        )
        .expect_err("native errors must reach the caller");
        assert_eq!(error, "native unregister failed");
    }
}
