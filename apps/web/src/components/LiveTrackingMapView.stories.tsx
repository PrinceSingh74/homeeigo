
import type { Meta, StoryObj } from "@storybook/react";
import { LiveTrackingMapView } from "./LiveTrackingMapView";

const meta: Meta<typeof LiveTrackingMapView> = {
  title: "Components/LiveTrackingMapView",
  component: LiveTrackingMapView,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    className: {
      control: "text",
      description: "Custom CSS classes for the container.",
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Save the original process.env
const originalEnv = process.env;

export const Default: Story = {
  args: {
    className: "w-96 h-96",
  },
  render: (args) => {
    // Mock the environment variable for this story
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "dummy-key", // Use a dummy key for Storybook
    };
    return <LiveTrackingMapView {...args} />;
  },
  play: () => {
    // Restore the original process.env after the story has rendered
    process.env = originalEnv;
  },
};

export const NoApiKey: Story = {
    args: {
        className: "w-96 h-96",
    },
    render: (args) => {
        // Mock the environment variable for this story
        process.env = {
        ...originalEnv,
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: undefined,
        };
        return <LiveTrackingMapView {...args} />;
    },
    play: () => {
        // Restore the original process.env after the story has rendered
        process.env = originalEnv;
    },
};

export const CustomLocation: Story = {
    args: {
        className: "w-96 h-96",
        position: { lat: 51.5074, lng: -0.1278 } // London
    },
    render: (args) => {
        // Mock the environment variable for this story
        process.env = {
        ...originalEnv,
        NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "dummy-key",
        };
        return <LiveTrackingMapView {...args} />;
    },
    play: () => {
        // Restore the original process.env after the story has rendered
        process.env = originalEnv;
    },
};
