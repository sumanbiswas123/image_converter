/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2563eb", // Custom primary blue
        secondary: "#f3f4f6", // Light background
      },
    },
  },
  plugins: [],
}

