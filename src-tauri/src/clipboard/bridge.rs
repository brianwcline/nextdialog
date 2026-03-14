use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use arboard::Clipboard;

/// Check if clipboard contains an image. If so, save it to a temp file
/// and return the path. Returns None if clipboard has no image.
pub fn save_clipboard_image() -> Result<Option<String>, String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("Clipboard error: {e}"))?;

    match clipboard.get_image() {
        Ok(img) => {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis();

            let path = std::env::temp_dir().join(format!("nextdialog-paste-{ts}.png"));

            // Convert RGBA to PNG
            let mut png_data = Vec::new();
            {
                let mut encoder = png::Encoder::new(
                    std::io::Cursor::new(&mut png_data),
                    img.width as u32,
                    img.height as u32,
                );
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                let mut writer = encoder
                    .write_header()
                    .map_err(|e| format!("PNG encode error: {e}"))?;
                writer
                    .write_image_data(&img.bytes)
                    .map_err(|e| format!("PNG write error: {e}"))?;
            }

            fs::write(&path, &png_data)
                .map_err(|e| format!("Failed to write temp image: {e}"))?;

            Ok(Some(path.to_string_lossy().to_string()))
        }
        Err(_) => Ok(None),
    }
}
