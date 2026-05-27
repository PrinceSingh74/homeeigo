import type { Preview } from "@storybook/react";
import { useEffect } from "react";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "centered",
    backgrounds: {
      default: "canvas",
      values: [
        { name: "canvas", value: "#f8fafc" },
        { name: "dark", value: "#0f172a" },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: "HOMIGO color theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const isDark =
        context.globals.theme === "dark" ||
        context.parameters.backgrounds?.default === "dark";

      useEffect(() => {
        document.documentElement.classList.toggle("dark", isDark);
      }, [isDark]);

      return (
        <div className="min-w-[320px] max-w-lg p-4 text-content">
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
