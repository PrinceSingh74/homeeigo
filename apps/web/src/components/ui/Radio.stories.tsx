import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Radio, RadioGroup } from "./Radio";

const meta = {
  title: "Components/Radio",
  component: RadioGroup,
  tags: ["autodocs"],
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const options = [
  { value: "option1", label: "Option 1" },
  { value: "option2", label: "Option 2" },
  { value: "option3", label: "Option 3" },
];

export const Default: Story = {
  args: { name: "demo", options },
  render: function RadioDemo() {
    const [value, setValue] = useState("option1");
    return (
      <RadioGroup
        name="demo"
        options={options}
        value={value}
        onChange={setValue}
      />
    );
  },
};

export const WithHelperText: Story = {
  args: { name: "payment", options: [] },
  render: function PaymentDemo() {
    const [value, setValue] = useState("upi");
    return (
      <RadioGroup
        name="payment"
        value={value}
        onChange={setValue}
        options={[
          { value: "upi", label: "UPI", helperText: "Instant transfer" },
          { value: "card", label: "Card", helperText: "Credit/Debit" },
          { value: "wallet", label: "Wallet", helperText: "HOMIGO balance" },
        ]}
      />
    );
  },
};

export const Error: Story = {
  args: { name: "demo", options },
  render: function ErrorDemo() {
    const [value, setValue] = useState("");
    return (
      <RadioGroup
        name="demo"
        options={options}
        value={value}
        onChange={setValue}
        variant="error"
      />
    );
  },
};

export const Disabled: Story = {
  args: { name: "demo", options },
  render: () => (
    <RadioGroup name="demo" options={options} value="option1" disabled />
  ),
};

export const SingleRadio: Story = {
  args: { name: "single", options: [{ value: "yes", label: "Yes" }] },
  render: () => <Radio label="Single radio button" name="single" value="yes" />,
};
