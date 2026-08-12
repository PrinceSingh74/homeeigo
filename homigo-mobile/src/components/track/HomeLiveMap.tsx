import React, { memo, useEffect, useRef, useState } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
import MapView, {
  AnimatedRegion,
  Marker,
  MarkerAnimated,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from "react-native-maps";

export type LatLng = { latitude: number; longitude: number };

const RIDER = require("../../../assets/rider.webp");

type Props = {
  provider: LatLng;
  destination: LatLng;
  region: Region;
  height: number;
  routePoints?: LatLng[];
  interactive?: boolean;
  /** Travel heading in degrees — rotates the bike marker (Uber/Rapido style). */
  bearing?: number | null;
  /** Keep the camera gently centred on the moving partner (live mode). */
  follow?: boolean;
};

/**
 * Uber/Rapido-grade tracking map. Real Google map, the partner shown as a
 * heading-rotated bike marker that GLIDES smoothly between GPS fixes
 * (AnimatedRegion), the actual road route, and an optional camera that follows
 * the rider. Fully interactive (pinch-zoom / pan / rotate).
 */
function HomeLiveMapInner({
  provider,
  destination,
  region,
  height,
  routePoints,
  interactive = true,
  bearing,
  follow = false,
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const line = routePoints && routePoints.length > 1 ? routePoints : [provider, destination];

  // Smoothly animate the partner marker between fixes (no teleport/jitter).
  const animated = useRef(
    new AnimatedRegion({
      latitude: provider.latitude,
      longitude: provider.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  ).current;

  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracks(false), 1400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // 900ms glide toward the newest position.
    // @ts-expect-error RN types accept the region shape here.
    animated.timing({ latitude: provider.latitude, longitude: provider.longitude, duration: 900, useNativeDriver: false }).start();
    if (follow) {
      mapRef.current?.animateCamera({ center: provider }, { duration: 900 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.latitude, provider.longitude, follow]);

  useEffect(() => {
    if (follow) return; // following the rider takes over framing
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(line.length > 1 ? line : [provider, destination], {
        edgePadding: { top: 64, right: 64, bottom: 64, left: 64 },
        animated: true,
      });
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination.latitude, destination.longitude, routePoints?.length, follow]);

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFill, { height }]}
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      initialRegion={region}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={interactive}
      zoomControlEnabled={false}
      toolbarEnabled={false}
      showsCompass={false}
      showsMyLocationButton={false}
      loadingEnabled
      loadingBackgroundColor="#062a1f"
    >
      {/* Destination — premium location pin */}
      <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={tracks} title="Service location">
        <View style={styles.destPin}>
          <View style={styles.destPinInner} />
        </View>
        <View style={styles.destPinStem} />
      </Marker>

      {/* Partner — heading-rotated bike marker that glides between fixes */}
      <MarkerAnimated
        coordinate={animated as unknown as LatLng}
        anchor={{ x: 0.5, y: 0.5 }}
        flat
        rotation={typeof bearing === "number" ? bearing : 0}
        tracksViewChanges={tracks}
        title="Your professional"
      >
        <View style={styles.riderWrap}>
          {/* heading cone points where the rider is going */}
          <View style={styles.headingCone} />
          <View style={styles.riderPuck}>
            {/* counter-rotate the photo so the face stays upright while the cone rotates */}
            <Image
              source={RIDER}
              style={[styles.riderImg, { transform: [{ rotate: `${-(typeof bearing === "number" ? bearing : 0)}deg` }] }]}
              resizeMode="cover"
            />
          </View>
        </View>
      </MarkerAnimated>

      {/* Route — soft glow under a bright emerald line */}
      <Polyline coordinates={line} strokeColor="rgba(16,185,129,0.22)" strokeWidth={12} lineCap="round" />
      <Polyline coordinates={line} strokeColor="#10b981" strokeWidth={5} lineCap="round" />
    </MapView>
  );
}

const styles = StyleSheet.create({
  destPin: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: "#0d9488",
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  destPinInner: { width: 8, height: 8, borderRadius: 999, backgroundColor: "#fff" },
  destPinStem: { width: 3, height: 8, marginTop: -1, backgroundColor: "#0d9488", alignSelf: "center" },

  riderWrap: { width: 60, height: 60, alignItems: "center", justifyContent: "center" },
  headingCone: {
    position: "absolute",
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 18,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "rgba(16,185,129,0.55)",
  },
  riderPuck: {
    width: 50,
    height: 50,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 3,
    borderColor: "#10b981",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  riderImg: { width: 44, height: 44, borderRadius: 999 },
});

export const HomeLiveMap = memo(HomeLiveMapInner);
export default HomeLiveMap;
