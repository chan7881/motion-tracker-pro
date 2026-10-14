import type { Config } from "tailwindcss";

export default {
    darkMode: "media", // 휴대폰의 라이트/다크 설정을 따른다 (index.css의 토큰과 같은 기준)
    content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
    prefix: "",
    theme: {
          container: {
                  center: true,
                  padding: "2rem",
                  screens: {
                            "2xl": "1400px",
                  },
          },
          extend: {
                  colors: {
                            border: "hsl(var(--border))",
                            input: "hsl(var(--input))",
                            ring: "hsl(var(--ring))",
                            background: "hsl(var(--background))",
                            foreground: "hsl(var(--foreground))",
                            primary: {
                                        DEFAULT: "hsl(var(--primary))",
                                        foreground: "hsl(var(--primary-foreground))",
                            },
                            secondary: {
                                        DEFAULT: "hsl(var(--secondary))",
                                        foreground: "hsl(var(--secondary-foreground))",
                            },
                            destructive: {
                                        DEFAULT: "hsl(var(--destructive))",
                                        foreground: "hsl(var(--destructive-foreground))",
                            },
                            muted: {
                                        DEFAULT: "hsl(var(--muted))",
                                        foreground: "hsl(var(--muted-foreground))",
                            },
                            accent: {
                                        DEFAULT: "hsl(var(--accent))",
                                        foreground: "hsl(var(--accent-foreground))",
                            },
                            popover: {
                                        DEFAULT: "hsl(var(--popover))",
                                        foreground: "hsl(var(--popover-foreground))",
                            },
                            card: {
                                        DEFAULT: "hsl(var(--card))",
                                        foreground: "hsl(var(--card-foreground))",
                            },
                            chart: {
                                        1: "hsl(var(--chart-1))",
                                        2: "hsl(var(--chart-2))",
                            },
                            sidebar: {
                                        DEFAULT: "hsl(var(--sidebar-background))",
                                        foreground: "hsl(var(--sidebar-foreground))",
                                        primary: "hsl(var(--sidebar-primary))",
                                        "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
                                        accent: "hsl(var(--sidebar-accent))",
                                        "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
                                        border: "hsl(var(--sidebar-border))",
                                        ring: "hsl(var(--sidebar-ring))",
                            },
                  },
                  borderRadius: {
                            lg: "var(--radius)",
                            md: "calc(var(--radius) - 4px)",
                            sm: "calc(var(--radius) - 6px)",
                  },
                  keyframes: {
                            "accordion-down": {
                                        from: {
                                                      height: "0",
                                        },
                                        to: {
                                                      height: "var(--radix-accordion-content-height)",
                                        },
                            },
                            "accordion-up": {
                                        from: {
                                                      height: "var(--radix-accordion-content-height)",
                                        },
                                        to: {
                                                      height: "0",
                                        },
                            },
                            "pulse-glow": {
                                        "0%, 100%": { boxShadow: "0 0 20px hsl(var(--primary) / 0.3)" },
                                        "50%": { boxShadow: "0 0 40px hsl(var(--primary) / 0.6)" },
                            },
                  },
                  animation: {
                            "accordion-down": "accordion-down 0.2s ease-out",
                            "accordion-up": "accordion-up 0.2s ease-out",
                            "pulse-glow": "pulse-glow 2s ease-in-out infinite",
                  },
                  fontFamily: {
                            // Pretendard를 못 받아 오면 기기 기본 글꼴로
                            sans: ["Pretendard Variable", "Pretendard", "-apple-system", "BlinkMacSystemFont", "system-ui", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "sans-serif"],
                  },
          },
    },
    plugins: [require("tailwindcss-animate")],
} satisfies Config;
