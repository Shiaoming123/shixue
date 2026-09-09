fn main() {
    let mut attributes = tauri_build::Attributes::new();
    attributes = attributes.plugin(
        "calendar-connections",
        tauri_build::InlinedPlugin::new()
            .commands(&[
                "status",
                "connect",
                "disconnect",
                "list_calendars",
                "free_busy",
                "stage_events",
                "read_staged",
                "ack_events",
                "reset_sync",
                "outbox_store",
                "write_prepare",
                "write_confirm",
                "write_run",
                "write_reconcile",
                "write_lookup",
                "write_disable",
                "write_stage_local",
                "write_read_local",
                "write_ack_local",
            ])
            .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
    );

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
