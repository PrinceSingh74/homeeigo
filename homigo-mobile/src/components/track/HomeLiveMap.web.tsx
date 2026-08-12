import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path, Defs, Stop, Circle, LinearGradient as SvgGradient } from "react-native-svg";

export type LatLng = { latitude: number; longitude: number };

type Props = {
  provider: LatLng;
  destination: LatLng;
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  height: number;
  routePoints?: LatLng[];
  interactive?: boolean;
  bearing?: number | null;
  follow?: boolean;
};

/**
 * Web fallback — `react-native-maps` is native-only. Renders a styled emerald
 * route illustration so the web export bundles and the card still looks alive.
 * Native (iOS/Android) uses HomeLiveMap.tsx (real Google/Apple map).
 */
export function HomeLiveMap({ height }: Props) {
  const W = 320;
  return (
    <View style={[StyleSheet.absoluteFill, { height, backgroundColor: "#062a1f" }]}>
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <SvgGradient id="wr" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#34d399" />
            <Stop offset="1" stopColor="#14b8a6" />
          </SvgGradient>
        </Defs>
        <Path
          d={`M ${W * 0.14} ${height * 0.74} C ${W * 0.34} ${height * 0.4}, ${W * 0.56} ${height * 0.7}, ${W * 0.86} ${height * 0.28}`}
          stroke="url(#wr)"
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx={W * 0.14} cy={height * 0.74} r={7} fill="#10b981" />
        <Circle cx={W * 0.86} cy={height * 0.28} r={7} fill="#34d399" />
      </Svg>
    </View>
  );
}

export default HomeLiveMap;
