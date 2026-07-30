/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
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
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
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
        /* FBV FleetOS design tokens (design.md §2) */
        navy: {
          950: '#060F1D',
          900: '#0A1A2F',
          800: '#0F2540',
          700: '#1A3A5C',
          100: '#C9D9EA',
          50: '#E8F0F8',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F2F5F9',
        },
        ink: {
          900: '#0E1B2A',
          600: '#46586D',
          400: '#7C8DA2',
        },
        accent: {
          DEFAULT: '#06B6D4',
          strong: '#0891B2',
          soft: '#CFF5FB',
          'on-navy': '#22D3EE',
          foreground: '#062831',
        },
        ok: { DEFAULT: '#16A34A', soft: '#DCFCE7', 'on-soft': '#15803D' },
        warn: { DEFAULT: '#F59E0B', soft: '#FEF3C7', 'on-soft': '#B45309' },
        alert: { DEFAULT: '#DC2626', soft: '#FEE2E2', 'on-soft': '#B91C1C' },
        inactive: { DEFAULT: '#64748B', soft: '#EEF2F6', 'on-soft': '#475569' },
        info: { DEFAULT: '#2563EB', soft: '#DBEAFE', 'on-soft': '#1D4ED8' },
        'hairline-dark': '#1A3A5C',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'table': ['13px', '20px'],
        'micro': ['11px', '14px'],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
        card: '12px',
        drawer: '16px',
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        card: '0 1px 2px rgba(10,26,47,.05), 0 4px 16px rgba(10,26,47,.06)',
        pop: '0 8px 32px rgba(6,15,29,.18)',
      },
      transitionTimingFunction: {
        'ops': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'snap': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        'pulse-live-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        },
        'alert-flash': {
          '0%': { backgroundColor: 'rgba(254,226,226,1)' },
          '100%': { backgroundColor: 'rgba(254,226,226,0)' },
        },
        'edge-glow': {
          '0%, 100%': { boxShadow: 'inset 0 0 0 0 rgba(220,38,38,0)' },
          '30%': { boxShadow: 'inset 0 0 64px 8px rgba(220,38,38,.28)' },
        },
        'texture-drift': {
          '0%': { transform: 'translate(0, 0)' },
          '100%': { transform: 'translate(20px, 20px)' },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        'pulse-live-ring': 'pulse-live-ring 1.8s cubic-bezier(0.22,1,0.36,1) infinite',
        'alert-flash': 'alert-flash 1.2s ease-out',
        'edge-glow': 'edge-glow 1.4s ease-out 1',
        'texture-drift': 'texture-drift 30s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
