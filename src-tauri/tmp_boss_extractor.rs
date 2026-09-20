use std::env;
use std::fs::File;
use std::io::Read;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: tmp_boss_extractor <file.zevtc>");
        std::process::exit(1);
    }
    let path = &args[1];
    let mut f = File::open(path).expect("open file");
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).expect("read file");
    
    println!("File size: {} bytes", buf.len());
    println!("First 64 bytes hex:");
    for (i, b) in buf.iter().take(64).enumerate() {
        print!("{:02x} ", b);
        if (i + 1) % 16 == 0 {
            println!();
        }
    }
    println!("\n\nRaw struct sizes:");
    println!("agent: {}", std::mem::size_of::<Agent>());
    println!("combatitem: {}", std::mem::size_of::<CombatItem>());
}

#[repr(C, packed)]
struct Agent {
    addr: u64,
    prof: u32,
    is_elite: u32,
    name: [u8; 64],
}

#[repr(C, packed)]
struct CombatItem {
    time: u64,
    src_agent: u64,
    dst_agent: u64,
    value: i64,
    buff_dmg: u32,
    overstack: u32,
    skill_id: u32,
    src_inst_id: u16,
    dst_inst_id: u16,
    extra: u16,
    pad: u16,
    buff: u8,
    pad2: u8,
    pad3: u16,
    pad4: u32,
}
