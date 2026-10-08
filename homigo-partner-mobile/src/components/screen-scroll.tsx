import { createContext, useContext } from "react";
import type { View } from "react-native";

/**
 * What a screen's scroll frame offers the fields inside it: "make sure this view, plus some room
 * under it, is visible once the keyboard is up". `PartnerScreen` provides it; a field asks for it on
 * focus so the control under the field (its Confirm button) is not left behind the docked footer.
 * Outside such a frame (a Modal sheet lays itself out) there is nothing to ask and the hook is a
 * no-op.
 */
export type RevealInScroll = (node: View | null, allowanceBelow: number) => void;

export const ScreenScrollContext = createContext<RevealInScroll | null>(null);

export function useRevealInScroll(): RevealInScroll {
  const reveal = useContext(ScreenScrollContext);
  return reveal ?? (() => {});
}
