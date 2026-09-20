use minisign::SecretKey;

fn main() {
    let path = "C:\\Users\\Usuario\\Desktop\\gw2-log-uploader\\src-tauri\\keys\\portal_protocol.key";
    let raw = std::fs::read_to_string(path).unwrap();
    // The file on disk is base64(minisign_text) on a single line.
    // Decode it once to recover the proper 2-line minisign secret-key text.
    let decoded = base64::decode(raw.trim()).unwrap();
    let text = String::from_utf8(decoded).unwrap();
    let sk_box = minisign::SecretKeyBox::from_string(&text).expect("bad key string");
    match SecretKey::from_box(sk_box, Some("portalprotocol".to_string())) {
        Ok(sk) => {
            let pk = minisign::PublicKey::from_secret_key(&sk).unwrap();
            println!("DERIVED pubkey (from .key) : {}", hex::encode(pk.to_bytes()));
        }
        Err(e) => {
            eprintln!("FAILED to load .key: {:?}", e);
            std::process::exit(2);
        }
    }
}
