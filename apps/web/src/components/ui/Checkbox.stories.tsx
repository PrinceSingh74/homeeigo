import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Accept terms and conditions" },
};

export const Checked: Story = {
  args: { label: "I agree to the terms", defaultChecked: true },
};

export const Disabled: Story = {
  args: { label: "Disabled checkbox", disabled: true },
};

export const WithHelperText: Story = {
  args: {
    label: "Subscribe to notifications",
    helperText: "You will receive updates about your bookings",
  },
};

export const Error: Story = {
  args: { label: "Accept terms", variant: "error" },
};

export const Indeterminate: Story = {
  render: function IndeterminateDemo() {
    const [items, setItems] = useState([false, false, false]);
    const someChecked = items.some(Boolean);
    const allChecked = items.every(Boolean);

    return (
      <div className="space-y-3">
        <Checkbox
          label="Select All"
          isIndeterminate={someChecked && !allChecked}
          checked={allChecked}
          onChange={() => setItems(items.map(() => !allChecked))}
        />
        {items.map((item, i) => (
          <Checkbox
            key={i}
            label={`Item ${i + 1}`}
            checked={item}
            onChange={() =>
              setItems(items.map((v, j) => (j === i ? !v : v)))
            }
          />
        ))}
      </div>
    );
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="space-y-3">
      <Checkbox size="sm" label="Small checkbox" />
      <Checkbox size="md" label="Medium checkbox" />
      <Checkbox size="lg" label="Large checkbox" />
    </div>
  ),
};
