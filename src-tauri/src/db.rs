use tauri_plugin_sql::{Migration, MigrationKind};

/// SQLite 数据库文件名，需与 tauri.conf.json 中 `plugins.sql.preload` 保持一致。
pub const DB_URL: &str = "sqlite:study.db";

/// 将当前 v1 快照按 `backup_key` 幂等备份。
///
/// 参数依次为：`backup_key`、期望的当前版本、备份时间。调用方必须等待该语句
/// 成功后，再执行 [`REPLACE_STUDY_STATE_AFTER_BACKUP_SQL`]。
#[allow(dead_code)] // v0.2 上层迁移接入前先固定数据库写入契约。
pub const BACKUP_STUDY_STATE_SQL: &str = r#"INSERT INTO study_state_backups (
        backup_key,
        version,
        payload,
        created_at
    )
    SELECT $1, version, payload, $3
    FROM study_state
    WHERE id = 1 AND version = $2
    ON CONFLICT(backup_key) DO NOTHING"#;

/// 仅当对应的 v1 备份存在时，才以新快照替换当前状态。
///
/// 参数依次为：`backup_key`、新版本、新 payload、更新时间。备份不存在时该语句
/// 影响零行，因此备份写入失败不会覆盖 `study_state` 中的 current 快照。
#[allow(dead_code)] // v0.2 上层迁移接入前先固定数据库写入契约。
pub const REPLACE_STUDY_STATE_AFTER_BACKUP_SQL: &str = r#"INSERT INTO study_state (
        id,
        version,
        payload,
        updated_at
    )
    SELECT 1, $2, $3, $4
    WHERE EXISTS (
        SELECT 1
        FROM study_state_backups
        WHERE backup_key = $1 AND version = 1
    )
      AND EXISTS (
        SELECT 1
        FROM study_state
        WHERE id = 1 AND version = 1
    )
    ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        payload = excluded.payload,
        updated_at = excluded.updated_at"#;

/// 返回按版本号升序执行的迁移列表。
///
/// 注意：每条迁移**只写一条 SQL 语句**。底层 sqlx 的 `execute` 不支持多语句，
/// 把 `CREATE TABLE` 和 `CREATE INDEX` 塞进同一条迁移会在运行时报错。
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_todos",
            sql: r#"CREATE TABLE IF NOT EXISTS todos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    done INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "index_todos_created_at",
            sql: "CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at DESC)",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "index_todos_done",
            sql: "CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done)",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_study_state",
            sql: r#"CREATE TABLE IF NOT EXISTS study_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    version INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )"#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_study_state_backups",
            sql: r#"CREATE TABLE IF NOT EXISTS study_state_backups (
                    backup_key TEXT PRIMARY KEY NOT NULL,
                    version INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )"#,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_v5_adds_versioned_study_state_backups_without_replacing_prior_migrations() {
        let migrations = migrations();

        assert_eq!(
            migrations
                .iter()
                .map(|migration| migration.version)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5]
        );
        assert_eq!(
            migrations
                .iter()
                .take(4)
                .map(|migration| migration.description)
                .collect::<Vec<_>>(),
            vec![
                "create_todos",
                "index_todos_created_at",
                "index_todos_done",
                "create_study_state",
            ]
        );

        let backup_migration = migrations
            .iter()
            .find(|migration| migration.version == 5)
            .expect("migration v5 must exist");
        assert_eq!(backup_migration.description, "create_study_state_backups");
        assert!(backup_migration
            .sql
            .contains("CREATE TABLE IF NOT EXISTS study_state_backups"));
        assert!(backup_migration.sql.contains("backup_key TEXT PRIMARY KEY"));
        assert!(backup_migration.sql.contains("version INTEGER NOT NULL"));
        assert!(backup_migration.sql.contains("payload TEXT NOT NULL"));
        assert!(backup_migration.sql.contains("created_at TEXT NOT NULL"));
    }

    #[test]
    fn backup_sql_copies_current_state_once_for_the_expected_version() {
        assert!(BACKUP_STUDY_STATE_SQL.contains("INSERT INTO study_state_backups"));
        assert!(BACKUP_STUDY_STATE_SQL.contains("SELECT $1, version, payload, $3"));
        assert!(BACKUP_STUDY_STATE_SQL.contains("FROM study_state"));
        assert!(BACKUP_STUDY_STATE_SQL.contains("id = 1 AND version = $2"));
        assert!(BACKUP_STUDY_STATE_SQL.contains("ON CONFLICT(backup_key) DO NOTHING"));
    }

    #[test]
    fn replacement_sql_requires_the_backup_before_touching_current_state() {
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("INSERT INTO study_state"));
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("WHERE EXISTS"));
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("FROM study_state_backups"));
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("backup_key = $1"));
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("version = 1"));
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("FROM study_state"));
        assert!(REPLACE_STUDY_STATE_AFTER_BACKUP_SQL.contains("ON CONFLICT(id) DO UPDATE"));
    }
}
