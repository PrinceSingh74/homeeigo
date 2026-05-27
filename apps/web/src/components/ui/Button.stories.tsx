import type { Meta, StoryObj } from "@storybook/react";
import { Download } from "lucide-react";
import { Button } from "./Button";

const meta = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: "Primary Button", variant: "primary" },
};

export const Secondary: Story = {
  args: { children: "Secondary Button", variant: "secondary" },
};

export const Outline: Story = {
  args: { children: "Outline Button", variant: "outline" },
};

export const Ghost: Story = {
  args: { children: "Ghost Button", variant: "ghost" },
};

export const WithIcon: Story = {
  args: {
    children: "Download",
    icon: <Download className="size-4" />,
  },
};

export const Loading: Story = {
  args: { children: "Loading", isLoading: true },
};

export const Disabled: Story = {
  args: { children: "Disabled Button", disabled: true },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button size="sm">Small Button</Button>
      <Button size="md">Medium Button</Button>
      <Button size="lg">Large Button</Button>
      <Button size="xl">Extra Large Button</Button>
    </div>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="success">Success</Button>
    </div>
  ),
};

export const FullWidth: Story = {
  args: { children: "Full Width Button", fullWidth: true },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};
