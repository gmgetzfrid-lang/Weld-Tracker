//! Authentication and user-profile management.

use crate::{Error, Result, Store, User};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use password_hash::SaltString;
use rusqlite::{params, Row};

pub(crate) fn hash_password(password: &str) -> Result<String> {
    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes).map_err(|e| Error::Hash(e.to_string()))?;
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|e| Error::Hash(e.to_string()))?;
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| Error::Hash(e.to_string()))?;
    Ok(hash.to_string())
}

fn verify_password(password: &str, stored_hash: &str) -> bool {
    match PasswordHash::new(stored_hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

fn user_from_row(r: &Row) -> rusqlite::Result<User> {
    Ok(User {
        id: r.get("id")?,
        username: r.get("username")?,
        display_name: r.get("display_name")?,
        role: r.get("role")?,
        must_change_password: r.get::<_, i64>("must_change_password")? != 0,
        active: r.get::<_, i64>("active")? != 0,
        created_at: r.get("created_at")?,
        last_login: r.get("last_login")?,
    })
}

const VALID_ROLES: &[&str] = &["admin", "editor", "viewer"];

impl Store {
    /// Return true when there are no users yet (fresh install).
    pub fn needs_bootstrap(&self) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        Ok(n == 0)
    }

    /// Authenticate a username/password pair. On success updates `last_login`.
    pub fn login(&self, username: &str, password: &str) -> Result<User> {
        let user = {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT id, username, display_name, role, password_hash,
                        must_change_password, active, created_at, last_login
                 FROM users WHERE username = ?1 COLLATE NOCASE",
            )?;
            let mut rows = stmt.query(params![username])?;
            let row = rows.next()?.ok_or(Error::InvalidCredentials)?;
            let stored_hash: String = row.get("password_hash")?;
            let active: i64 = row.get("active")?;
            if active == 0 {
                return Err(Error::AccountDisabled);
            }
            if !verify_password(password, &stored_hash) {
                return Err(Error::InvalidCredentials);
            }
            user_from_row(row)?
        };
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE users SET last_login = datetime('now') WHERE id = ?1",
                params![user.id],
            )?;
        }
        self.audit(&user.username, "login", "user", &user.id.to_string(), "");
        Ok(user)
    }

    /// Change a user's own password. Requires the current password to match.
    pub fn change_password(
        &self,
        username: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<()> {
        validate_password(new_password)?;
        let stored: String = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT password_hash FROM users WHERE username = ?1 COLLATE NOCASE",
                params![username],
                |r| r.get(0),
            )
            .map_err(|_| Error::NotFound)?
        };
        if !verify_password(current_password, &stored) {
            return Err(Error::InvalidCredentials);
        }
        let new_hash = hash_password(new_password)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET password_hash = ?1, must_change_password = 0 WHERE username = ?2 COLLATE NOCASE",
            params![new_hash, username],
        )?;
        drop(conn);
        self.audit(username, "password_change", "user", "", "self-service");
        Ok(())
    }

    /// Admin: create a new login profile. Returns the created user.
    pub fn create_user(
        &self,
        acting_role: &str,
        username: &str,
        display_name: &str,
        role: &str,
        password: &str,
        must_change: bool,
    ) -> Result<User> {
        require_admin(acting_role)?;
        let username = username.trim();
        if username.is_empty() {
            return Err(Error::Invalid("username is required".into()));
        }
        if !VALID_ROLES.contains(&role) {
            return Err(Error::Invalid(format!("invalid role '{role}'")));
        }
        validate_password(password)?;
        let hash = hash_password(password)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (username, display_name, role, password_hash, must_change_password, active)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            params![username, display_name, role, hash, must_change as i64],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(err, _)
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Error::Invalid(format!("username '{username}' already exists"))
            }
            other => Error::Db(other),
        })?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.audit("admin", "create", "user", &id.to_string(), username);
        self.get_user(id)
    }

    pub fn get_user(&self, id: i64) -> Result<User> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, role, password_hash,
                    must_change_password, active, created_at, last_login
             FROM users WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        let row = rows.next()?.ok_or(Error::NotFound)?;
        user_from_row(row).map_err(Error::from)
    }

    pub fn list_users(&self) -> Result<Vec<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, role, password_hash,
                    must_change_password, active, created_at, last_login
             FROM users ORDER BY username COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], user_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Admin: enable/disable a profile. The last active admin cannot be disabled.
    pub fn set_user_active(&self, acting_role: &str, id: i64, active: bool) -> Result<()> {
        require_admin(acting_role)?;
        if !active {
            self.guard_last_admin(id)?;
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET active = ?1 WHERE id = ?2",
            params![active as i64, id],
        )?;
        Ok(())
    }

    /// Admin: change a profile's role.
    pub fn set_user_role(&self, acting_role: &str, id: i64, role: &str) -> Result<()> {
        require_admin(acting_role)?;
        if !VALID_ROLES.contains(&role) {
            return Err(Error::Invalid(format!("invalid role '{role}'")));
        }
        if role != "admin" {
            self.guard_last_admin(id)?;
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET role = ?1 WHERE id = ?2",
            params![role, id],
        )?;
        Ok(())
    }

    /// Admin: reset another user's password. Forces a change at next login.
    pub fn admin_reset_password(
        &self,
        acting_role: &str,
        id: i64,
        new_password: &str,
    ) -> Result<()> {
        require_admin(acting_role)?;
        validate_password(new_password)?;
        let hash = hash_password(new_password)?;
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE users SET password_hash = ?1, must_change_password = 1 WHERE id = ?2",
            params![hash, id],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        drop(conn);
        self.audit("admin", "password_reset", "user", &id.to_string(), "");
        Ok(())
    }

    /// Prevent removing the very last active admin.
    fn guard_last_admin(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let is_admin: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM users WHERE id = ?1 AND role = 'admin' AND active = 1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if is_admin == 0 {
            return Ok(());
        }
        let admin_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1",
            [],
            |r| r.get(0),
        )?;
        if admin_count <= 1 {
            return Err(Error::Invalid(
                "cannot disable or demote the last active administrator".into(),
            ));
        }
        Ok(())
    }
}

fn require_admin(role: &str) -> Result<()> {
    if role == "admin" {
        Ok(())
    } else {
        Err(Error::PermissionDenied)
    }
}

fn validate_password(pw: &str) -> Result<()> {
    if pw.chars().count() < 6 {
        return Err(Error::Invalid(
            "password must be at least 6 characters".into(),
        ));
    }
    Ok(())
}
