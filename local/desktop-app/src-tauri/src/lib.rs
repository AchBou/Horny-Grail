use std::fs::{self, File};
use std::io::{BufReader, Read, Cursor};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use image::{DynamicImage, ImageOutputFormat, imageops::FilterType, GenericImageView, RgbaImage, RgbImage};
use tauri::{Manager, path::BaseDirectory};
use wait_timeout::ChildExt;

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

fn fit_on_square_canvas(img: &DynamicImage, size: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    let scale_w = size as f32 / w as f32;
    let scale_h = size as f32 / h as f32;
    let scale = scale_w.min(scale_h);
    let tw = (w as f32 * scale).round().max(1.0) as u32;
    let th = (h as f32 * scale).round().max(1.0) as u32;

    let resized = img.resize(tw, th, FilterType::Lanczos3);
    let rgb = flatten_to_white(&resized);
    let mut canvas = RgbImage::from_pixel(size, size, image::Rgb([255, 255, 255]));
    let x_offset = (size - tw) / 2;
    let y_offset = (size - th) / 2;

    for (x, y, pixel) in rgb.enumerate_pixels() {
        canvas.put_pixel(x + x_offset, y + y_offset, *pixel);
    }

    canvas
}

#[tauri::command]
fn generate_thumbnail(path: String, max_dimension: Option<u32>, quality_hint: Option<u8>) -> Result<Vec<u8>, String> {
    let max_dim = max_dimension.unwrap_or(150);
    let quality = quality_hint.unwrap_or(88);

    // Decode image
    let img = image::open(&path).map_err(|e| format!("failed to decode image: {}", e))?;

    let rgb = fit_on_square_canvas(&img, max_dim);

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

fn resolve_ffmpeg_path(app: &tauri::AppHandle) -> String {
    app.path()
        .resolve("binaries/ffmpeg.exe", BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists())
        .and_then(|path| path.to_str().map(|value| value.to_string()))
        .unwrap_or_else(|| "ffmpeg".to_string())
}

#[tauri::command]
fn generate_video_thumbnail(app: tauri::AppHandle, path: String, max_dimension: Option<u32>, quality_hint: Option<u8>) -> Result<Vec<u8>, String> {
    let max_dim = max_dimension.unwrap_or(320).clamp(1, 4096);
    let quality = quality_hint.unwrap_or(90).clamp(1, 100);
    // ffmpeg's q:v is inverse quality; keep high quality but bounded file size.
    let jpeg_quality = ((101_u16.saturating_sub(quality as u16)) / 10).clamp(2, 10).to_string();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("failed to build temporary thumbnail name: {}", e))?
        .as_millis();
    let out_path = std::env::temp_dir().join(format!(
        "horny-grail-thumb-{}-{}.jpg",
        std::process::id(),
        now_ms
    ));
    let out_path_string = out_path
        .to_str()
        .ok_or_else(|| "temporary thumbnail path is not valid UTF-8".to_string())?
        .to_string();
    let filter = format!(
        "scale={0}:{0}:force_original_aspect_ratio=decrease,pad={0}:{0}:(ow-iw)/2:(oh-ih)/2:color=0x111827",
        max_dim
    );

    let ffmpeg_path = resolve_ffmpeg_path(&app);
    let mut child = Command::new(ffmpeg_path)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "0.15",
            "-i",
            &path,
            "-frames:v",
            "1",
            "-vf",
            &filter,
            "-q:v",
            &jpeg_quality,
            "-update",
            "1",
            &out_path_string,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start ffmpeg: {}", e))?;

    let status = match child
        .wait_timeout(Duration::from_secs(15))
        .map_err(|e| format!("failed while waiting for ffmpeg: {}", e))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&out_path);
            return Err("ffmpeg thumbnail generation timed out".to_string());
        }
    };

    if !status.success() {
        let mut stderr = String::new();
        if let Some(mut pipe) = child.stderr.take() {
            let _ = pipe.read_to_string(&mut stderr);
        }
        let _ = fs::remove_file(&out_path);
        return Err(format!(
            "ffmpeg thumbnail generation failed{}",
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        ));
    }

    let bytes = fs::read(&out_path).map_err(|e| format!("failed to read generated thumbnail: {}", e))?;
    let _ = fs::remove_file(&out_path);
    if bytes.is_empty() {
        return Err("ffmpeg generated an empty thumbnail".to_string());
    }

    Ok(bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![compute_sha256_streaming, generate_thumbnail, generate_video_thumbnail])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
