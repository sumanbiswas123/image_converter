import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import ChromeColorPicker from "./ColorPicker";
import UploadIcon from "./UploadIcon";

function App() {
  const [outputFormat, setOutputFormat] = useState("jpg");
  const [convertedPath, setConvertedPath] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [singleFilePreview, setSingleFilePreview] = useState("");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [hasAlpha, setHasAlpha] = useState(false);
  const [isMultipleMode, setIsMultipleMode] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [folderImages, setFolderImages] = useState([]);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionLog, setConversionLog] = useState([]);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [currentAction, setCurrentAction] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const unlisten = listen("conversion-progress", (event) => {
      const payload = event.payload;
      setConversionProgress(payload.progress);
      setCurrentAction(payload.message);
      setConversionLog((prevLog) => [
        ...prevLog,
        { status: payload.status, message: payload.message },
      ]);
      if (payload.status === "complete") {
        setIsConverting(false);
        alert("Batch conversion complete!");
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (folderPath) {
      loadImagesFromFolder();
    } else {
      setFolderImages([]);
    }
  }, [folderPath]);

  const loadImagesFromFolder = async () => {
    try {
      const imageThumbnails = await invoke("get_image_thumbnails", {
        folderPath,
      });
      setFolderImages(imageThumbnails);
    } catch (error) {
      console.error("Error reading folder:", error);
      alert("Failed to read folder contents: " + error);
    }
  };

  const selectFolder = async () => {
    try {
      const selected = await invoke("select_folder_from_backend");
      if (selected) {
        setFolderPath(selected);
      }
    } catch (error) {
      console.error("Error selecting folder:", error);
      alert("Error selecting folder: " + error);
    }
  };

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);

    const previewUrl = URL.createObjectURL(file);
    setSingleFilePreview(previewUrl);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height).data;
      let alphaFound = false;
      for (let i = 3; i < imageData.length; i += 4) {
        if (imageData[i] < 255) {
          alphaFound = true;
          break;
        }
      }
      setHasAlpha(alphaFound);
    };
    img.src = previewUrl;
  };

  const convertSingleImage = async () => {
    if (!selectedFile) return;
    setIsConverting(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const buffer = Array.from(new Uint8Array(reader.result));
      try {
        const payload = {
          fileBytes: buffer,
          filename: selectedFile.name,
          format: outputFormat,
          bgColor:
            outputFormat === "jpg" && hasAlpha
              ? bgColor.replace("#", "")
              : null,
        };
        const path = await invoke("convert_image", payload);
        setConvertedPath(path);
        alert("Image converted successfully!");
      } catch (err) {
        alert("Conversion failed: " + err);
      } finally {
        setIsConverting(false);
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const convertMultipleImages = async () => {
    if (folderImages.length === 0) return;
    setIsConverting(true);
    setConversionLog([]);
    setConversionProgress(0);
    setCurrentAction("Starting batch conversion...");
    const job = {
      files: folderImages.map((img) => img.path),
      format: outputFormat,
      bgColor: outputFormat === "jpg" ? bgColor.replace("#", "") : null,
    };
    await invoke("convert_all_images", { job });
  };

  const convertImage = () => {
    if (isMultipleMode) {
      convertMultipleImages();
    } else {
      convertSingleImage();
    }
  };

  // --- NEW DRAG-AND-DROP HANDLERS ---
  const handleDragOver = (e) => {
    e.preventDefault(); // This is crucial to allow dropping
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    processFile(file);
  };

  const toggleMode = (newMode) => {
    setIsMultipleMode(newMode);
    setConvertedPath("");
    setConversionLog([]);
    setSelectedFile(null);
    setSingleFilePreview("");
    setFolderPath("");
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 shadow-2xl shadow-black/20 rounded-2xl p-6 sm:p-10 max-w-3xl w-full space-y-8">
        <h1 className="text-3xl font-bold text-slate-100 text-center">
          Image Converter
        </h1>
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-300 border-b border-slate-700 pb-2">
            1. Select Input
          </h2>
          <div className="flex bg-slate-900/50 p-1 rounded-lg">
            <button
              onClick={() => toggleMode(false)}
              className={`w-full px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                !isMultipleMode
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-700/50"
              }`}
            >
              Single Image
            </button>
            <button
              onClick={() => toggleMode(true)}
              className={`w-full px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${
                isMultipleMode
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:bg-slate-700/50"
              }`}
            >
              Folder Images
            </button>
          </div>

          {!isMultipleMode ? (
            <label
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`flex justify-center items-center w-full h-64 transition-colors duration-300 bg-slate-900/50 border-2 border-dashed rounded-lg appearance-none cursor-pointer hover:border-slate-600 focus:outline-none ${
                isDragging
                  ? "border-indigo-500 bg-slate-800"
                  : "border-slate-700"
              }`}
            >
              {singleFilePreview ? (
                <img
                  src={singleFilePreview}
                  alt="Preview"
                  className="max-h-full max-w-full object-contain rounded-md p-2"
                />
              ) : (
                <div className="flex flex-col items-center">
                  <UploadIcon />
                  <span className="font-medium text-slate-500">
                    Drop file or click to upload
                  </span>
                  <span className="text-xs text-slate-600 mt-1">
                    PNG, JPG, WEBP
                  </span>
                </div>
              )}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <button
                  onClick={selectFolder}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 px-4 rounded-lg text-sm font-semibold transition-colors"
                >
                  Browse Folders
                </button>
                {folderPath && (
                  <span className="text-xs text-slate-400 truncate flex-1">
                    {folderPath}
                  </span>
                )}
              </div>
              {folderImages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400">
                    {folderImages.length} images found
                  </p>
                  {/* --- THUMBNAIL GRID: Larger thumbnails --- */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-64 overflow-y-auto p-2 bg-slate-900/50 rounded-lg">
                    {folderImages.map((image) => (
                      <div
                        key={image.path}
                        title={image.name}
                        className="relative aspect-square rounded-md overflow-hidden group bg-slate-700"
                      >
                        <img
                          src={image.data_url}
                          alt={image.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                          <p
                            className="text-white text-[10px] leading-tight truncate"
                            title={image.name}
                          >
                            {image.name}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-300 border-b border-slate-700 pb-2">
            2. Configure Output
          </h2>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Convert To
            </label>
            <select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="jpg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WEBP</option>
            </select>
          </div>
          {outputFormat === "jpg" && (hasAlpha) && (!isMultipleMode) && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">
                Background Color
              </label>
              <ChromeColorPicker
                value={bgColor}
                onChange={(color) => setBgColor(color)}
              />
            </div>
          )}
        </div>

        {/* --- ACTION & RESULTS AREA --- */}
        <div className="space-y-6 pt-6 border-t border-slate-700">
          <button
            onClick={convertImage}
            disabled={
              isConverting ||
              (!isMultipleMode && !selectedFile) ||
              (isMultipleMode && folderImages.length === 0)
            }
            className="w-full font-bold text-lg py-3 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white active:scale-[0.98]"
          >
            {isConverting ? "Converting..." : "Convert"}
          </button>

          {isConverting && (
            <div className="space-y-2">
              <div className="w-full bg-slate-700 rounded-full h-2.5">
                <div
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${conversionProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-center text-slate-400 truncate">
                {currentAction}
              </p>
            </div>
          )}
          {conversionLog.length > 0 && !isConverting && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-slate-300">
                Conversion Log
              </h3>
              <div className="max-h-32 overflow-y-auto bg-slate-900/50 p-3 rounded-lg text-xs space-y-1">
                {conversionLog.map((log, index) => (
                  <p
                    key={index}
                    className={
                      log.status === "error" ? "text-red-400" : "text-slate-400"
                    }
                  >
                    {log.message}
                  </p>
                ))}
              </div>
            </div>
          )}
          {convertedPath && (
            <div className="p-3 bg-green-500/10 text-sm text-green-300 rounded-md">
              <p>✅ Converted image saved at:</p>
              <span className="break-all text-xs opacity-80">
                {convertedPath}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
