import { useState, useEffect } from "react";

const COLOR_PRESETS = [
"#f44336", "#e91e63", "#9c27b0", "#673ab7", 
"#3f51b5", "#2196f3", "#03a9f4", "#00bcd4", 
"#009688", "#4caf50", "#8bc34a", "#cddc39", 
"#ffeb3b", "#ffc107", "#ff9800", "#ff5722",
"#795548", "#607d8b", "#000000", "#ffffff"
];

function ChromeColorPicker({ value, onChange }) {
const [hexValue, setHexValue] = useState(value || "#ffffff");
const [isPickerOpen, setIsPickerOpen] = useState(false);

useEffect(() => {
  if (value !== hexValue) {
    setHexValue(value);
  }
}, [value]);

const handleHexChange = (e) => {
  let newValue = e.target.value;
  
  if (!newValue.startsWith('#')) {
    newValue = '#' + newValue;
  }
  
  if (/^#([0-9A-Fa-f]{0,6})$/.test(newValue)) {
    setHexValue(newValue);
    
    if (newValue.length === 7) {
      onChange(newValue);
    }
  }
};

const handleColorPickerChange = (e) => {
  const newColor = e.target.value;
  setHexValue(newColor);
  onChange(newColor);
};

const handlePresetClick = (color) => {
  setHexValue(color);
  onChange(color);
  setIsPickerOpen(false);
};

// Close picker when clicking outside
useEffect(() => {
  if (!isPickerOpen) return;
  
  const handleClickOutside = (event) => {
    if (!event.target.closest('.color-picker-container')) {
      setIsPickerOpen(false);
    }
  };
  
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [isPickerOpen]);

return (
  <div className="relative color-picker-container">
    <div className="flex items-center space-x-3">
      <div 
        className="h-8 w-8 rounded-md border border-gray-300 cursor-pointer"
        style={{ backgroundColor: hexValue }}
        onClick={() => setIsPickerOpen(!isPickerOpen)}
      >
        <input
          type="color"
          value={hexValue}
          onChange={handleColorPickerChange}
          className="opacity-0 absolute h-8 w-8 cursor-pointer"
        />
      </div>
      <div className="flex items-center border border-gray-300 rounded-md overflow-hidden">
        <span className="bg-gray-100 px-2 py-1 text-gray-600 text-sm border-r">
          #
        </span>
        <input
          type="text"
          value={hexValue.replace("#", "")}
          onChange={handleHexChange}
          placeholder="RRGGBB"
          className="px-2 py-1 w-20 text-sm focus:outline-none"
          maxLength={6}
        />
      </div>
    </div>
    
    {isPickerOpen && (
      <div className="absolute mt-2 p-3 bg-white rounded-md shadow-lg border border-gray-200 z-10">
        <div className="grid grid-cols-5 gap-2 mb-3">
          {COLOR_PRESETS.map((color) => (
            <div
              key={color}
              className="h-6 w-6 rounded-sm cursor-pointer border border-gray-200"
              style={{ backgroundColor: color }}
              onClick={() => handlePresetClick(color)}
            />
          ))}
        </div>
        <input
          type="color"
          value={hexValue}
          onChange={handleColorPickerChange}
          className="w-full h-8 cursor-pointer"
        />
      </div>
    )}
  </div>
);
}

export default ChromeColorPicker