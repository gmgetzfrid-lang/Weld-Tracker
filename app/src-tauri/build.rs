fn main() {
    // The exe's embedded Windows resources (icon, version info) come from
    // these files. Without explicit triggers, CI's cached target/ keeps the
    // OLD resources linked into the binary even after the files change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
