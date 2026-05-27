import type { Meta, StoryObj } from "@storybook/react";
import { Search, CheckCircle2 } from "lucide-react";
import { Input } from "./Input";

const meta = {
  title: "Components/Input",
  component: Input,
  tags: ["autodocs"],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: "Enter text…",
    label: "Label",
  },
};

export const SearchVariant: Story = {
  args: {
    variant: "search",
    placeholder: "Search services…",
    iconLeft: <Search className="size-4" />,
  },
};

export const WithError: Story = {
  args: {
    variant: "error",
    label: "Email",
    placeholder: "user@example.com",
    errorMessage: "Please enter a valid email",
    defaultValue: "invalid-email",
  },
};

export const WithSuccess: Story = {
  args: {
    variant: "success",
    label: "Email",
    placeholder: "user@example.com",
    successMessage: "Email verified!",
    defaultValue: "user@example.com",
    iconRight: <CheckCircle2 className="size-4 text-success" />,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    label: "Disabled Input",
    placeholder: "Cannot type here…",
  },
};

export const WithCharacterCount: Story = {
  args: {
    label: "Message",
    placeholder: "Write your message…",
    characterCount: true,
    maxCharacters: 100,
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <Input size="sm" placeholder="Small…" label="Small" />
      <Input size="md" placeholder="Medium…" label="Medium" />
      <Input size="lg" placeholder="Large…" label="Large" />
      <Input size="xl" placeholder="Extra large…" label="Extra Large" />
    </div>
  ),
};

export const DarkMode: Story = {
  args: {
    label: "Email",
    placeholder: "user@example.com",
  },
  globals: { theme: "dark" },
  parameters: { backgrounds: { default: "dark" } },
};
