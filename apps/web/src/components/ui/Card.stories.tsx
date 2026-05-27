import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card";

const meta = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="space-y-2">
        <h3 className="font-semibold text-content">Card Title</h3>
        <p className="text-sm text-muted">
          Default card with surface styling.
        </p>
      </div>
    ),
  },
};

export const Bordered: Story = {
  args: {
    variant: "bordered",
    children: (
      <div className="space-y-2">
        <h3 className="font-semibold">Bordered Card</h3>
        <p className="text-sm text-muted">Stronger border emphasis.</p>
      </div>
    ),
  },
};

export const Elevated: Story = {
  args: {
    variant: "elevated",
    children: (
      <div className="space-y-2">
        <h3 className="font-semibold">Elevated Card</h3>
        <p className="text-sm text-muted">Higher elevation shadow.</p>
      </div>
    ),
  },
};

export const Interactive: Story = {
  args: {
    variant: "interactive",
    children: (
      <div className="space-y-2">
        <h3 className="font-semibold">Interactive Card</h3>
        <p className="text-sm text-muted">Hover to lift with shadow.</p>
      </div>
    ),
  },
};

export const DarkMode: Story = {
  args: {
    variant: "glass",
    children: (
      <div className="space-y-2">
        <h3 className="font-semibold">Glass Card</h3>
        <p className="text-sm text-muted">Works in dark theme.</p>
      </div>
    ),
  },
  globals: { theme: "dark" },
  parameters: { backgrounds: { default: "dark" } },
};
