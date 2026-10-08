/**
 * AI avatar — flat gradient circle matching Codex style.
 */
export default function AiAvatar({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="ai-avatar"
      aria-label="AI"
    >
      <defs>
        <linearGradient id="ai-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5B6FE0" />
          <stop offset="50%" stopColor="#9B8BF0" />
          <stop offset="100%" stopColor="#5B6FE0" />
        </linearGradient>
      </defs>

      <circle cx="16" cy="16" r="16" fill="url(#ai-grad)" />

      <text
        x="16"
        y="16.5"
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize="10.5"
        fontWeight="700"
        fontFamily="'DM Sans', -apple-system, sans-serif"
        letterSpacing="0.8"
      >
        AI
      </text>
    </svg>
  );
}
