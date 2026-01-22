import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Manrope";

const { fontFamily } = loadFont();

const insights = [
  {
    icon: "💡",
    title: "Spending Pattern Detected",
    description:
      "Your entertainment expenses have increased by 23% compared to last month. Consider setting a budget cap.",
    color: "#f1c40f",
    priority: "info",
  },
  {
    icon: "🎯",
    title: "Savings Opportunity",
    description:
      "By reducing dining out by $150/month, you could save $1,800 annually for your emergency fund.",
    color: "#2ecc71",
    priority: "success",
  },
  {
    icon: "⚠️",
    title: "Upcoming Cash Crunch",
    description: "Your balance may drop below $500 around January 25th due to multiple bills.",
    color: "#e74c3c",
    priority: "warning",
  },
  {
    icon: "📈",
    title: "Positive Trend",
    description: "Your savings rate improved from 12% to 18% over the last 3 months. Keep it up!",
    color: "#135bec",
    priority: "success",
  },
];

const aiCapabilities = [
  { icon: "🔍", text: "Real-time analysis" },
  { icon: "🎯", text: "Personalized tips" },
  { icon: "⚡", text: "Risk detection" },
  { icon: "💰", text: "Savings optimization" },
];

export const AIInsightsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ============= PREMIUM AI BRAIN ANIMATIONS =============

  // Brain orb pulse
  const brainPulse = interpolate(Math.sin(frame * 0.08), [-1, 1], [0.95, 1.05]);

  // Rotating neural ring
  const neuralRotation = frame * 0.8;

  // Brain entrance
  const brainEntrance = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
  });

  const brainScale = interpolate(brainEntrance, [0, 1], [0, 1]);

  // Neural connections animation
  const neuralConnections = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const innerRadius = 100;
    const outerRadius = 180;

    const pulseOffset = (frame * 0.1 + i * 0.5) % (Math.PI * 2);
    const pulseFactor = (Math.sin(pulseOffset) + 1) / 2;

    return {
      x1: Math.cos(angle + frame * 0.01) * innerRadius,
      y1: Math.sin(angle + frame * 0.01) * innerRadius,
      x2:
        Math.cos(angle + frame * 0.01) * (innerRadius + (outerRadius - innerRadius) * pulseFactor),
      y2:
        Math.sin(angle + frame * 0.01) * (innerRadius + (outerRadius - innerRadius) * pulseFactor),
      opacity: 0.3 + pulseFactor * 0.5,
    };
  });

  // Floating data particles around brain
  const dataParticles = Array.from({ length: 20 }, (_, i) => {
    const orbit = 150 + (i % 3) * 40;
    const speed = 0.02 + (i % 5) * 0.005;
    const angle = (i / 20) * Math.PI * 2 + frame * speed;

    const x = Math.cos(angle) * orbit;
    const y = Math.sin(angle) * orbit * 0.4; // Elliptical orbit
    const z = Math.sin(angle) * 50;

    const opacity = interpolate(z, [-50, 50], [0.2, 0.8]);
    const scale = interpolate(z, [-50, 50], [0.5, 1.2]);

    return { x, y, opacity, scale, color: i % 2 === 0 ? "#135bec" : "#9b59b6" };
  });

  // Typing effect for AI response
  const fullText =
    "Based on your financial data, I've analyzed your spending patterns and identified several opportunities to optimize your cash flow and build wealth faster.";
  const typingDelay = fps * 0.6;
  const typingDuration = fps * 2.5;
  const typingProgress = interpolate(
    frame - typingDelay,
    [0, typingDuration],
    [0, fullText.length],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const visibleText = fullText.slice(0, Math.floor(typingProgress));
  const cursorBlink = Math.sin(frame * 0.35) > 0;

  // Insight cards with staggered 3D entrance
  const getInsightAnimation = (index: number) => {
    const delay = fps * 1 + index * 18;

    const slideProgress = spring({
      frame: frame - delay,
      fps,
      config: { damping: 18, stiffness: 100 },
    });

    const x = interpolate(slideProgress, [0, 1], [100, 0]);
    const opacity = interpolate(slideProgress, [0, 0.3, 1], [0, 0, 1]);
    const rotateY = interpolate(slideProgress, [0, 1], [-20, 0]);
    const scale = interpolate(slideProgress, [0, 1], [0.9, 1]);

    return { x, opacity, rotateY, scale };
  };

  // AI capability badges animation
  const getCapabilityAnimation = (index: number) => {
    const delay = fps * 2.5 + index * 6;
    const progress = spring({
      frame: frame - delay,
      fps,
      config: { damping: 15, stiffness: 120 },
    });

    const scale = interpolate(progress, [0, 1], [0, 1]);
    const opacity = interpolate(progress, [0, 0.5, 1], [0, 0, 1]);

    return { scale, opacity };
  };

  // Glowing background orbs
  const bgOrbs = [
    { x: 350, y: 400, size: 500, color: "#9b59b6" },
    { x: 400, y: 600, size: 400, color: "#135bec" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at 30% 50%, #1a1f2e 0%, #0a0e17 60%)",
        fontFamily,
        overflow: "hidden",
      }}
    >
      {/* Background glowing orbs */}
      {bgOrbs.map((orb, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: orb.x - orb.size / 2,
            top: orb.y - orb.size / 2,
            width: orb.size,
            height: orb.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${orb.color}20 0%, transparent 70%)`,
            filter: "blur(80px)",
          }}
        />
      ))}

      <div
        style={{
          display: "flex",
          height: "100%",
          padding: "50px 60px",
          gap: 60,
        }}
      >
        {/* Left side - AI Brain visualization */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Neural connections */}
          <svg
            width={400}
            height={400}
            viewBox="-200 -200 400 400"
            style={{
              position: "absolute",
              transform: `scale(${brainScale})`,
            }}
          >
            {neuralConnections.map((conn, i) => (
              <g key={i}>
                <line
                  x1={conn.x1}
                  y1={conn.y1}
                  x2={conn.x2}
                  y2={conn.y2}
                  stroke="#9b59b6"
                  strokeWidth={2}
                  opacity={conn.opacity}
                />
                <circle cx={conn.x2} cy={conn.y2} r={4} fill="#9b59b6" opacity={conn.opacity} />
              </g>
            ))}

            {/* Rotating ring */}
            <circle
              cx={0}
              cy={0}
              r={120}
              fill="none"
              stroke="url(#neuralGradient)"
              strokeWidth={2}
              strokeDasharray="10 5"
              transform={`rotate(${neuralRotation})`}
              opacity={0.5}
            />
            <circle
              cx={0}
              cy={0}
              r={160}
              fill="none"
              stroke="url(#neuralGradient)"
              strokeWidth={1}
              strokeDasharray="5 10"
              transform={`rotate(${-neuralRotation * 0.7})`}
              opacity={0.3}
            />

            <defs>
              <linearGradient id="neuralGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#135bec" />
                <stop offset="100%" stopColor="#9b59b6" />
              </linearGradient>
            </defs>
          </svg>

          {/* Data particles */}
          {dataParticles.map((p, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `calc(50% + ${p.x}px)`,
                top: `calc(42% + ${p.y}px)`,
                width: 6 * p.scale,
                height: 6 * p.scale,
                borderRadius: "50%",
                backgroundColor: p.color,
                opacity: p.opacity * brainScale,
                boxShadow: `0 0 10px ${p.color}`,
              }}
            />
          ))}

          {/* AI Brain Core */}
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #9b59b6 0%, #135bec 50%, #1abc9c 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `scale(${brainScale * brainPulse})`,
              boxShadow: `
                0 0 60px rgba(155, 89, 182, 0.5),
                0 0 120px rgba(19, 91, 236, 0.3),
                inset 0 0 60px rgba(255, 255, 255, 0.1)
              `,
              position: "relative",
            }}
          >
            {/* Inner glow */}
            <div
              style={{
                position: "absolute",
                width: 160,
                height: 160,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)",
              }}
            />
            <span style={{ fontSize: 80, zIndex: 1 }}>🤖</span>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: 42,
              fontWeight: 800,
              color: "white",
              marginTop: 36,
              transform: `scale(${brainScale})`,
            }}
          >
            <span
              style={{
                background: "linear-gradient(135deg, #9b59b6 0%, #135bec 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              AI
            </span>{" "}
            Powered Insights
          </h1>

          {/* AI Response with typing */}
          <div
            style={{
              maxWidth: 450,
              marginTop: 24,
              backgroundColor: "rgba(155, 89, 182, 0.1)",
              borderRadius: 16,
              padding: 24,
              border: "1px solid rgba(155, 89, 182, 0.3)",
              backdropFilter: "blur(10px)",
            }}
          >
            <p
              style={{
                fontSize: 16,
                color: "#d1d5db",
                lineHeight: 1.7,
                minHeight: 80,
              }}
            >
              {visibleText}
              {typingProgress < fullText.length && (
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 18,
                    backgroundColor: "#9b59b6",
                    marginLeft: 2,
                    opacity: cursorBlink ? 1 : 0,
                    transform: "translateY(3px)",
                  }}
                />
              )}
            </p>
          </div>

          {/* AI Capabilities */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 28,
              maxWidth: 450,
              justifyContent: "center",
            }}
          >
            {aiCapabilities.map((cap, i) => {
              const { scale, opacity } = getCapabilityAnimation(i);
              return (
                <div
                  key={cap.text}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    backgroundColor: "rgba(46, 204, 113, 0.15)",
                    border: "1px solid rgba(46, 204, 113, 0.3)",
                    padding: "8px 16px",
                    borderRadius: 24,
                    transform: `scale(${scale})`,
                    opacity,
                  }}
                >
                  <span style={{ fontSize: 16 }}>{cap.icon}</span>
                  <span style={{ fontSize: 13, color: "#2ecc71", fontWeight: 500 }}>
                    {cap.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right side - Insight Cards */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            justifyContent: "center",
            perspective: 1000,
          }}
        >
          {insights.map((insight, i) => {
            const { x, opacity, rotateY, scale } = getInsightAnimation(i);

            return (
              <div
                key={insight.title}
                style={{
                  backgroundColor: "#151c2c",
                  borderRadius: 16,
                  padding: 22,
                  borderLeft: `4px solid ${insight.color}`,
                  transform: `translateX(${x}px) rotateY(${rotateY}deg) scale(${scale})`,
                  opacity,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
                  transformStyle: "preserve-3d",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Subtle gradient overlay */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: `linear-gradient(90deg, ${insight.color}08 0%, transparent 50%)`,
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                    position: "relative",
                  }}
                >
                  {/* Icon */}
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      backgroundColor: `${insight.color}20`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      flexShrink: 0,
                      boxShadow: `0 0 20px ${insight.color}30`,
                    }}
                  >
                    {insight.icon}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1 }}>
                    <h3
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: "white",
                        marginBottom: 6,
                      }}
                    >
                      {insight.title}
                    </h3>
                    <p
                      style={{
                        fontSize: 14,
                        color: "#9ca3af",
                        lineHeight: 1.5,
                      }}
                    >
                      {insight.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
