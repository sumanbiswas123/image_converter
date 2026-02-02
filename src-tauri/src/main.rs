#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::File;
use std::io::Cursor;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::thread; // Import the thread module
use tauri::command;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::{DialogExt, FilePath}; // Add Deserialize

use dirs;
use image::ImageFormat;
use webp::Encoder;

// Struct for the frontend to send a list of files
#[derive(Deserialize)]
struct ConversionJob {
    files: Vec<String>,
    format: String,
    bg_color: Option<String>,
}

// Struct for the backend to send progress updates
#[derive(Clone, serde::Serialize)]
struct ConversionPayload {
    status: String, // "processing", "success", "error", "complete"
    message: String,
    progress: u32, // Percentage 0-100
}

#[derive(Serialize)]
struct Thumbnail {
    path: PathBuf,
    name: String,
    data_url: String,
}

#[command]
fn select_folder_from_backend(app: AppHandle) -> Result<Option<PathBuf>, String> {
    let (sender, receiver) = channel();
    app.dialog()
        .file()
        .set_title("Select a folder")
        .pick_folder(move |folder_path: Option<FilePath>| {
            sender.send(folder_path).unwrap();
        });
    match receiver.recv() {
        Ok(path) => Ok(path.and_then(|p| p.as_path().map(|path_ref| path_ref.to_path_buf()))),
        Err(_) => Err("Failed to receive folder path from dialog".to_string()),
    }
}

#[command]
fn get_image_thumbnails(folder_path: String) -> Result<Vec<Thumbnail>, String> {
    let entries =
        fs::read_dir(&folder_path).map_err(|e| format!("Failed to read directory: {}", e))?;
    let thumbnails: Vec<Thumbnail> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map_or(false, |ext| {
                        matches!(ext.to_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp")
                    })
        })
        .filter_map(|path| {
            let mime_type = match path.extension().and_then(|s| s.to_str()) {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                _ => return None,
            };
            if let Ok(bytes) = fs::read(&path) {
                let base64_str = general_purpose::STANDARD.encode(&bytes);
                let data_url = format!("data:{};base64,{}", mime_type, base64_str);
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                Some(Thumbnail {
                    path,
                    name,
                    data_url,
                })
            } else {
                None
            }
        })
        .collect();
    Ok(thumbnails)
}

#[command]
async fn convert_all_images(app: AppHandle, job: ConversionJob) -> Result<(), String> {
    thread::spawn(move || {
        let total_files = job.files.len();
        for (i, file_path) in job.files.iter().enumerate() {
            let progress = ((i + 1) as f32 / total_files as f32 * 100.0) as u32;
            let file_name = Path::new(file_path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // Emit "processing" event
            app.emit(
                "conversion-progress",
                Some(ConversionPayload {
                    status: "processing".to_string(),
                    message: format!("Converting {}...", file_name),
                    progress,
                }),
            )
            .unwrap();

            // Perform the conversion for one file
            let result = convert_image_from_path(
                file_path.clone(),
                job.format.clone(),
                job.bg_color.clone(),
            );

            // Emit result event
            match result {
                Ok(converted_path) => {
                    app.emit(
                        "conversion-progress",
                        Some(ConversionPayload {
                            status: "success".to_string(),
                            message: format!("✅ {} -> {}", file_name, converted_path),
                            progress,
                        }),
                    )
                    .unwrap();
                }
                Err(e) => {
                    app.emit(
                        "conversion-progress",
                        Some(ConversionPayload {
                            status: "error".to_string(),
                            message: format!("❌ {} - {}", file_name, e),
                            progress,
                        }),
                    )
                    .unwrap();
                }
            }
        }

        // Emit final "complete" event
        app.emit(
            "conversion-progress",
            Some(ConversionPayload {
                status: "complete".to_string(),
                message: "All conversions finished.".to_string(),
                progress: 100,
            }),
        )
        .unwrap();
    });

    Ok(()) // Return immediately to unblock the frontend
}

#[command]
fn convert_image(
    file_bytes: Vec<u8>,
    filename: String,
    format: String,
    bg_color: Option<String>,
) -> Result<String, String> {
    let rgb_color = if let Some(hex) = &bg_color {
        if hex.len() != 6 && hex.len() != 7 {
            return Err("Invalid hex color format".to_string());
        }
        let hex_clean = hex.trim_start_matches('#');
        let r = u8::from_str_radix(&hex_clean[0..2], 16)
            .map_err(|_| "Invalid hex color".to_string())?;
        let g = u8::from_str_radix(&hex_clean[2..4], 16)
            .map_err(|_| "Invalid hex color".to_string())?;
        let b = u8::from_str_radix(&hex_clean[4..6], 16)
            .map_err(|_| "Invalid hex color".to_string())?;
        Some([r, g, b])
    } else {
        None
    };

    let reader = Cursor::new(file_bytes);
    let format_guess = image::guess_format(reader.get_ref())
        .map_err(|e| format!("Failed to guess image format: {}", e))?;
    let dyn_img =
        image::load(reader, format_guess).map_err(|e| format!("Failed to load image: {}", e))?;
    let desktop = dirs::desktop_dir().ok_or("Failed to find Desktop directory")?;
    let output_dir = desktop.join("ImageConverter");
    process_and_save_image(dyn_img, filename, format, rgb_color, output_dir, false)
}

#[command]
fn convert_image_from_path(
    file_path: String,
    format: String,
    bg_color: Option<String>,
) -> Result<String, String> {
    // println!("{bg_color} getting the background values");
    let rgb_color = if let Some(hex) = &bg_color {
        if hex.len() != 6 && hex.len() != 7 {
            return Err("Invalid hex color format".to_string());
        }
        let hex_clean = hex.trim_start_matches('#');
        let r = u8::from_str_radix(&hex_clean[0..2], 16)
            .map_err(|_| "Invalid hex color".to_string())?;
        let g = u8::from_str_radix(&hex_clean[2..4], 16)
            .map_err(|_| "Invalid hex color".to_string())?;
        let b = u8::from_str_radix(&hex_clean[4..6], 16)
            .map_err(|_| "Invalid hex color".to_string())?;
        Some([r, g, b])
    } else {
        None
    };

    let path = Path::new(&file_path);
    let filename = path
        .file_name()
        .ok_or("Invalid file path")?
        .to_string_lossy()
        .to_string();
    let dyn_img =
        image::open(path).map_err(|e| format!("Failed to open image {}: {}", file_path, e))?;
    let source_dir = path
        .parent()
        .ok_or("Could not find parent directory of the image")?;
    let source_folder_name = source_dir
        .file_name()
        .ok_or("Could not get source folder name")?
        .to_string_lossy();
    let output_dir = source_dir.join(format!("{}_converted", source_folder_name));
    process_and_save_image(dyn_img, filename, format, rgb_color, output_dir, true)
}

fn process_and_save_image(
    dyn_img: image::DynamicImage,
    filename: String,
    format: String,
    rgb_color: Option<[u8; 3]>,
    output_dir: PathBuf,
    is_batch: bool,
) -> Result<String, String> {
    let (ext, encoded_data) = match format.as_str() {
        "jpg" | "jpeg" => {
            let rgba_img = dyn_img.to_rgba8();
            let has_alpha_pixels = rgba_img.pixels().any(|p| p[3] < 255);
            if has_alpha_pixels {
                if let Some(color) = rgb_color {
                    // Use the parsed RGB color
                    let mut background = image::RgbImage::new(dyn_img.width(), dyn_img.height());
                    for pixel in background.pixels_mut() {
                        *pixel = image::Rgb(color);
                    }

                    for (x, y, pixel) in rgba_img.enumerate_pixels() {
                        let alpha = pixel[3] as f32 / 255.0;
                        let bg_pixel = background.get_pixel_mut(x, y);
                        bg_pixel[0] =
                            ((1.0 - alpha) * bg_pixel[0] as f32 + alpha * pixel[0] as f32) as u8;
                        bg_pixel[1] =
                            ((1.0 - alpha) * bg_pixel[1] as f32 + alpha * pixel[1] as f32) as u8;
                        bg_pixel[2] =
                            ((1.0 - alpha) * bg_pixel[2] as f32 + alpha * pixel[2] as f32) as u8;
                    }

                    let mut buf = Vec::new();
                    image::DynamicImage::ImageRgb8(background)
                        .write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
                        .map_err(|e| format!("Failed to write JPEG: {}", e))?;
                    ("jpg", buf)
                } else {
                    println!("It is going to default mode");
                    // If no background color is provided, use white as default for batch mode
                    if is_batch {
                        let default_color = [255, 255, 255]; // White
                        let mut background =
                            image::RgbImage::new(dyn_img.width(), dyn_img.height());
                        for pixel in background.pixels_mut() {
                            *pixel = image::Rgb(default_color);
                        }

                        for (x, y, pixel) in rgba_img.enumerate_pixels() {
                            let alpha = pixel[3] as f32 / 255.0;
                            let bg_pixel = background.get_pixel_mut(x, y);
                            bg_pixel[0] = ((1.0 - alpha) * bg_pixel[0] as f32
                                + alpha * pixel[0] as f32)
                                as u8;
                            bg_pixel[1] = ((1.0 - alpha) * bg_pixel[1] as f32
                                + alpha * pixel[1] as f32)
                                as u8;
                            bg_pixel[2] = ((1.0 - alpha) * bg_pixel[2] as f32
                                + alpha * pixel[2] as f32)
                                as u8;
                        }

                        let mut buf = Vec::new();
                        image::DynamicImage::ImageRgb8(background)
                            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
                            .map_err(|e| format!("Failed to write JPEG: {}", e))?;
                        ("jpg", buf)
                    } else {
                        return Err("Image has transparency. Please provide a background color."
                            .to_string());
                    }
                }
            } else {
                let mut buf = Vec::new();
                dyn_img
                    .to_rgb8()
                    .write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)
                    .map_err(|e| format!("Failed to write JPEG: {}", e))?;
                ("jpg", buf)
            }
        }
        "png" => {
            let mut buf = Vec::new();
            dyn_img
                .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
                .map_err(|e| format!("Failed to write PNG: {}", e))?;
            ("png", buf)
        }
        "webp" => {
            let rgba_img = dyn_img.to_rgba8();
            let encoder = Encoder::from_rgba(&rgba_img, rgba_img.width(), rgba_img.height());
            let quality = 75f32;
            let webp_data = encoder.encode(quality);
            ("webp", webp_data.to_vec())
        }
        _ => return Err("Unsupported output format".to_string()),
    };

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output folder: {}", e))?;
    let base_name = filename.split('.').next().unwrap_or("converted");
    let output_filename = if is_batch {
        format!("{}.{}", base_name, ext)
    } else {
        format!("{}_converted.{}", base_name, ext)
    };
    let output_path = output_dir.join(output_filename);
    let mut output_file =
        File::create(&output_path).map_err(|e| format!("Failed to create output file: {}", e))?;
    output_file
        .write_all(&encoded_data)
        .map_err(|e| format!("Failed to write image: {}", e))?;
    Ok(output_path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            convert_image,
            select_folder_from_backend,
            get_image_thumbnails,
            convert_all_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
