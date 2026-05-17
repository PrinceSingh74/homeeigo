/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/components/**/*.{js,jsx,ts,tsx}",
    "./src/screens/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        homigo: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          900: "#0F172A",
          blue: "#2563EB",
          violet: "#7C3AED",
          cyan: "#06B6D4",
          pink: "#EC4899",
          gold: "#D4AF37",
        },
        primary: "#2563EB",
        violet: "#7C3AED",
        cyan: "#06B6D4",
        pink: "#EC4899",
        gold: "#D4AF37",
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
      },
      borderRadius: {
        xs: "6px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "32px",
      },
    },
  },
  plugins: [],
};
