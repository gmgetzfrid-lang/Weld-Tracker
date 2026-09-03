//! Print a shipped NDE rule set as JSON (for fixtures and documentation):
//! `cargo run -p weldcore --example dump_rules -- ep-5-5-1`
fn main() {
    let key = std::env::args().nth(1).unwrap_or_else(|| "ep-5-5-1".into());
    let rs = weldcore::nde::RuleSet::preset(&key).expect("unknown preset (ep-5-5-1 | asme-b31.3)");
    println!("{}", serde_json::to_string_pretty(&rs).unwrap());
}
