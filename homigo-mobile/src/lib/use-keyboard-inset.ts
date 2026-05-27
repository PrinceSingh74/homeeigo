import { useEffect, useState } from "react";
import { Keyboard, Platform, type KeyboardEvent } from "react-native";

/**
 * Keyboard height above bottom of screen (0 when hidden).
 * Use with composer-layout.composerKeyboardPadding() for footer lift.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (e: KeyboardEvent) => {
      setInset(e.endCoordinates.height);
    };
    const onHide = () => setInset(0);

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);

    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  return inset;
}
