fn main() {
    let mut attributes = tauri_build::Attributes::new();

    if !cfg!(feature = "notification") {
        attributes = attributes.plugin(
            "notification",
            tauri_build::InlinedPlugin::new()
                .commands(&["notify", "request_permission", "is_permission_granted"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        );
    }

    if !cfg!(feature = "autostart") {
        attributes = attributes.plugin(
            "autostart",
            tauri_build::InlinedPlugin::new()
                .commands(&["enable", "disable", "is_enabled"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        );
    }

    tauri_build::try_build(attributes).expect("failed to build Tauri application");
}
