use std::fs;
use gw2_log_uploader::evtc_parser::{
    parse_is_quick_play, parse_boss_id, parse_boss_name,
};

fn main() {
    let path = "C:/Users/Usuario/.hermes/desktop-attachments/20260906-173108-2.zevtc";
    let bytes = fs::read(path).expect("read log");
    let boss_id = parse_boss_id(&bytes).map(|(id, _)| id);
    let boss_name = parse_boss_name(&bytes);
    let quick_play = parse_is_quick_play(&bytes);
    println!("quick_play={:?} boss_id={:?} boss_name={:?}", quick_play, boss_id, boss_name);
}
