import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { PLATFORM_COLORS, PlatformName } from "@/src/constants";

interface Props {
  platform: PlatformName;
  size?: number;
  style?: ViewStyle;
}

export default function PlatformAvatar({ platform, size = 40, style }: Props) {
  const bg = PLATFORM_COLORS[platform];
  const letter = platform === "Other" ? "?" : platform.charAt(0);
  return (
    <View
      testID={`platform-avatar-${platform.toLowerCase()}`}
      style={[
        styles.avatar,
        { backgroundColor: bg, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.45 }]}>{letter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
