import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DarkTheme, Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MarketScreen } from './src/screens/MarketScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useStore } from './src/store/useStore';

type TabParamList = {
  Market: undefined;
  Portfolio: undefined;
  Live: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0B1020',
    card: '#111827',
    border: '#1F2937',
    primary: '#38BDF8',
    text: '#F8FAFC',
  },
};

const ModeBadge = () => {
  const mode = useStore((state) => state.mode);
  return (
    <View
      style={[
        styles.modeBadge,
        mode === 'DEMO' ? styles.modeBadgeDemo : styles.modeBadgeReal,
      ]}
    >
      <Text style={styles.modeBadgeText}>{mode}</Text>
    </View>
  );
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: '#111827' },
          headerTintColor: '#F8FAFC',
          headerRight: () => <ModeBadge />,
          tabBarActiveTintColor: '#38BDF8',
          tabBarInactiveTintColor: '#94A3B8',
          tabBarStyle: {
            backgroundColor: '#111827',
            borderTopColor: '#1F2937',
            height: 64,
            paddingTop: 6,
            paddingBottom: 8,
          },
          tabBarIcon: ({ focused, color, size }) => {
            const iconMap: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
              Market: focused ? 'trending-up' : 'trending-up-outline',
              Portfolio: focused ? 'wallet' : 'wallet-outline',
              Live: focused ? 'pulse' : 'pulse-outline',
              Settings: focused ? 'settings' : 'settings-outline',
            };
            const iconName = iconMap[route.name as keyof TabParamList];
            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Market" component={MarketScreen} />
        <Tab.Screen name="Portfolio" component={PortfolioScreen} />
        <Tab.Screen name="Live" component={LiveScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  modeBadge: {
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  modeBadgeDemo: {
    backgroundColor: '#78350F',
  },
  modeBadgeReal: {
    backgroundColor: '#14532D',
  },
  modeBadgeText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
