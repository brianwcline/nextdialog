import type { ITheme } from "@xterm/xterm";

export const darkTheme: ITheme = {
  background: "#1E1E2E",
  foreground: "#CDD6F4",
  cursor: "#A6ADC8",
  cursorAccent: "#1E1E2E",
  selectionBackground: "#585B7066",
  selectionForeground: "#CDD6F4",
  black: "#45475A",
  red: "#F38BA8",
  green: "#A6E3A1",
  yellow: "#F9E2AF",
  blue: "#89B4FA",
  magenta: "#CBA6F7",
  cyan: "#94E2D5",
  white: "#BAC2DE",
  brightBlack: "#585B70",
  brightRed: "#F38BA8",
  brightGreen: "#A6E3A1",
  brightYellow: "#F9E2AF",
  brightBlue: "#89B4FA",
  brightMagenta: "#CBA6F7",
  brightCyan: "#94E2D5",
  brightWhite: "#A6ADC8",
};

export const terminalOptions = {
  theme: darkTheme,
  fontFamily: '"Geist Mono", "SF Mono", Monaco, "Cascadia Code", monospace',
  fontSize: 13,
  lineHeight: 1.4,
  cursorBlink: true,
  cursorStyle: "bar" as const,
  allowTransparency: false,
  scrollback: 10000,
  allowProposedApi: true,
};
