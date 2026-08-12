"use client";

import React from "react";

type State = { hasError: boolean };

export class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackTitle?: string },
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-line bg-surface/70 p-5 text-center text-sm text-muted">
          {this.props.fallbackTitle ?? "Something went wrong loading this section."}
        </div>
      );
    }
    return this.props.children;
  }
}
