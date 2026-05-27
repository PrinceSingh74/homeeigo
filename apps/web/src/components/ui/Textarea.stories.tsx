import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";

const meta = {
  title: "Components/Textarea",
  component: Textarea,
  tags: ["autodocs"],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: "Write your message…",
    label: "Message",
  },
};

export const WithCharacterCount: Story = {
  args: {
    label: "Review",
    placeholder: "Share your experience…",
    showCharacterCount: true,
    maxCharacters: 500,
  },
};

export const AutoResize: Story = {
  args: {
    label: "Expandable Textarea",
    placeholder: "This textarea grows as you type…",
    autoResize: true,
  },
};

export const WithError: Story = {
  args: {
    variant: "error",
    label: "Feedback",
    errorMessage: "Please enter at least 10 characters",
    placeholder: "Your feedback here…",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    label: "Disabled Textarea",
    placeholder: "Cannot type here…",
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <Textarea size="sm" label="Small" placeholder="3 rows…" />
      <Textarea size="md" label="Medium" placeholder="5 rows…" />
      <Textarea size="lg" label="Large" placeholder="8 rows…" />
      <Textarea size="xl" label="Extra Large" placeholder="12 rows…" />
    </div>
  ),
};
