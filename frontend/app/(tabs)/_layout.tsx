import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useOrders } from "@/src/context/OrderContext";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export default function TabsLayout() {
  const { colors } = useOrders();

  const tabIcon =
    (name: IconName, filled: IconName) =>
    ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
      <Ionicons name={focused ? filled : name} size={size} color={color} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.info,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          height: 84,
          paddingTop: 8,
          paddingBottom: 24,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarTestID: "tab-home",
          tabBarIcon: tabIcon("home-outline", "home"),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "Add Order",
          tabBarTestID: "tab-add",
          tabBarIcon: tabIcon("add-circle-outline", "add-circle"),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: "Analytics",
          tabBarTestID: "tab-analytics",
          tabBarIcon: tabIcon("bar-chart-outline", "bar-chart"),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarTestID: "tab-settings",
          tabBarIcon: tabIcon("settings-outline", "settings"),
        }}
      />
    </Tabs>
  );
}
