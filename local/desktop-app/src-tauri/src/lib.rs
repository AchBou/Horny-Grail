use std::fs::{File};
use std::io::{BufReader, Read, Cursor};

use sha2::{Digest, Sha256};
use image::{DynamicImage, ImageOutputFormat, imageops::FilterType, GenericImageView, RgbaImage, RgbImage};

#[tauri::command]
fn compute_sha256_streaming(path: String) -> Result<String, String> {
    let file = File::open(&path).map_err(|e| format!("failed to open file: {}", e))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024 * 4]; // 4 MiB buffer

    loop {
        let n = reader.read(&mut buffer).map_err(|e| format!("failed to read file: {}", e))?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }

    let result = hasher.finalize();
    Ok(hex::encode(result))
}



fn flatten_to_white(img: &DynamicImage) -> RgbImage {
    // Convert to RGBA first (alpha = 255 if originally opaque)
    let rgba: RgbaImage = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut out = RgbImage::new(w, h);
    for (x, y, p) in rgba.enumerate_pixels() {
        let [r, g, b, a] = p.0;
        let a_f = (a as f32) / 255.0;
        let r_out = (r as f32 * a_f + 255.0 * (1.0 - a_f)).round() as u8;
        let g_out = (g as f32 * a_f + 255.0 * (1.0 - a_f)).round() as u8;
        let b_out = (b as f32 * a_f + 255.0 * (1.0 - a_f)).round() as u8;
        out.put_pixel(x, y, image::Rgb([r_out, g_out, b_out]));
    }
    out
}

#[tauri::command]
fn generate_thumbnail(path: String, max_dimension: Option<u32>, quality_hint: Option<u8>) -> Result<Vec<u8>, String> {
    let max_dim = max_dimension.unwrap_or(150);
    let quality = quality_hint.unwrap_or(88);

    // Decode image
    let img = image::open(&path).map_err(|e| format!("failed to decode image: {}", e))?;

    // Compute target size (do not upscale)
    let (w, h) = img.dimensions();
    let scale_w = max_dim as f32 / w as f32;
    let scale_h = max_dim as f32 / h as f32;
    let scale = scale_w.min(scale_h).min(1.0);
    let tw = (w as f32 * scale).round().max(1.0) as u32;
    let th = (h as f32 * scale).round().max(1.0) as u32;

    // Resize with high-quality filter
    let resized = img.resize(tw, th, FilterType::Lanczos3);

    // Flatten any alpha onto white background
    let rgb = flatten_to_white(&resized);

    // Encode JPEG into memory
    let mut jpeg_bytes: Vec<u8> = Vec::new();
    {
        let mut cursor = Cursor::new(&mut jpeg_bytes);
        let dyn_img = DynamicImage::ImageRgb8(rgb);
        dyn_img
            .write_to(&mut cursor, ImageOutputFormat::Jpeg(quality as u8))
            .map_err(|e| format!("failed to encode jpeg: {}", e))?;
    }

    Ok(jpeg_bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![compute_sha256_streaming, generate_thumbnail])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
