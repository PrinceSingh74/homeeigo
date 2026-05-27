import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Select } from "./Select";

const serviceOptions = [
  { value: "cleaning", label: "Cleaning" },
  { value: "ac", label: "AC Service" },
  { value: "plumbing", label: "Plumbing" },
  { value: "electrician", label: "Electrician" },
];

const meta = {
  title: "Components/Select",
  component: Select,
  tags: ["autodocs"],
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { options: serviceOptions },
  render: function SelectDemo() {
    const [value, setValue] = useState("");
    return (
      <Select
        className="w-80"
        options={serviceOptions}
        placeholder="Select service…"
        value={value}
        onChange={(v) => setValue(typeof v === "string" ? v : v[0] ?? "")}
      />
    );
  },
};

export const WithLabelAndError: Story = {
  args: {
    className: "w-80",
    label: "Service Type",
    options: serviceOptions,
    variant: "error",
    errorMessage: "Please select a service",
  },
};

export const Searchable: Story = {
  args: { options: serviceOptions },
  render: function SearchableDemo() {
    const [value, setValue] = useState("");
    return (
      <Select
        className="w-80"
        label="Service"
        isSearchable
        options={serviceOptions}
        placeholder="Search and select…"
        value={value}
        onChange={(v) => setValue(typeof v === "string" ? v : v[0] ?? "")}
      />
    );
  },
};

export const MultiSelect: Story = {
  args: { options: serviceOptions },
  render: function MultiDemo() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <Select
        className="w-80"
        label="Services"
        isMulti
        isClearable
        options={serviceOptions}
        placeholder="Select multiple…"
        value={value}
        onChange={(v) => setValue(Array.isArray(v) ? v : [v])}
      />
    );
  },
};

export const Disabled: Story = {
  args: {
    className: "w-80",
    disabled: true,
    options: serviceOptions,
    placeholder: "Disabled",
  },
};

export const WithGroups: Story = {
  args: { options: serviceOptions },
  render: function GroupsDemo() {
    const [value, setValue] = useState("");
    const groupedOptions = [
      { value: "deep-clean", label: "Deep Cleaning", group: "Cleaning" },
      { value: "sofa", label: "Sofa Clean", group: "Cleaning" },
      { value: "ac-gas", label: "Gas Refill", group: "AC" },
      { value: "ac-service", label: "Full Service", group: "AC" },
      { value: "plumb", label: "Plumbing", group: "Repairs" },
    ];
    return (
      <Select
        className="w-80"
        label="Service category"
        options={groupedOptions}
        placeholder="Pick a service…"
        value={value}
        onChange={(v) => setValue(typeof v === "string" ? v : v[0] ?? "")}
      />
    );
  },
};
