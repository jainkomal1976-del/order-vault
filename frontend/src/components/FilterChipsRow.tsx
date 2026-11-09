import React from "react";
import { ScrollView, Pressable, Text, StyleSheet, View } from "react-native";
import { useOrders } from "@/src/context/OrderContext";

export interface ChipItem {
  label: string;
  value: string;
}

interface Props {
  items: ChipItem[];
  selected: string;
  onSelect: (value: string) => void;
  testIDPrefix?: string;
}

// Single horizontal scroller, chips never wrap. 56pt row / 36pt chip.
export default function FilterChipsRow({
  items,
  selected,
  onSelect,
  testIDPrefix = "chip",
}: Props) {
  const { colors } = useOrders();
  return (
    <View style={[styles.row, { backgroundColor: "transparent" }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {items.map((it) => {
          const isSel = it.value === selected;
          return (
            <Pressable
              key={it.value}
              testID={`${testIDPrefix}-${it.value.toLowerCase().replace(/\s+/g, "-")}`}
              onPress={() => onSelect(it.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: isSel
                    ? colors.brandPrimary
                    : colors.surfaceSecondary,
                  borderColor: isSel ? colors.brandPrimary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isSel ? colors.onBrandPrimary : colors.onSurfaceSecondary,
                  },
                ]}
              >
                {it.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: 56, justifyContent: "center" },
  content: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
});
