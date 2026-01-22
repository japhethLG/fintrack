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

const features = [
  {
    icon: "💰",
    title: "Income Management",
    description: "Track salary, freelance, and all income sources with flexible scheduling",
    color: "#2ecc71",
    gradient: "linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)",
  },
  {
    icon: "📊",
    title: "Expense Tracking",
    description: "Manage bills, loans, credit cards, and installments in one place",
    color: "#e74c3c",
    gradient: "linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)",
  },
  {
    icon: "📅",
    title: "Smart Calendar",
    description: "Interactive calendar with daily balance indicators and projections",
    color: "#f1c40f",
    gradient: "linear-gradient(135deg, #f1c40f 0%, #f39c12 100%)",
  },
  {
    icon: "🎯",
    title: "Bill Coverage",
    description: "See if upcoming bills can be covered with current balance",
    color: "#135bec",
    gradient: "linear-gradient(135deg, #135bec 0%, #0d47a1 100%)",
  },
  {
    icon: "🤖",
    title: "AI Insights",
    description: "Get personalized financial recommendations powered by Gemini AI",
    color: "#9b59b6",
    gradient: "linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%)",
  },
  {
    icon: "📈",
    title: "Cash Flow Forecast",
    description: "Visualize your financial future with accurate projections",
    color: "#1abc9c",
    gradient: "linear-gradient(135deg, #1abc9c 0%, #16a085 100%)",
  },
];

export const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ============= PREMIUM ANIMATIONS =============

  // Title entrance with 3D effect
  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 100 },
  });

  const titleScale = interpolate(titleProgress, [0, 1], [0.8, 1]);
  const titleY = interpolate(titleProgress, [0, 1], [-60, 0]);
  const titleRotateX = interpolate(titleProgress, [0, 1], [30, 0]);

  // Feature cards with 3D flip and stagger
  const getFeatureAnimation = (index: number) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const delay = fps * 0.4 + row * 20 + col * 8;

    // 3D flip entrance
    const flipProgress = spring({
      frame: frame - delay,
      fps,
      config: { damping: 15, stiffness: 80, mass: 1.1 },
    });

    const rotateY = interpolate(flipProgress, [0, 1], [90, 0]);
    const scale = interpolate(flipProgress, [0, 0.5, 1], [0.6, 1.05, 1]);
    const opacity = interpolate(flipProgress, [0, 0.3, 1], [0, 0, 1]);
    const z = interpolate(flipProgress, [0, 0.5, 1], [-200, 50, 0]);

    return { rotateY, scale, opacity, z };
  };

  // Highlight effect - sequential focus on each card
  const highlightCycle = durationInFrames - fps * 1; // Stop highlighting 1s before end
  const highlightProgress = interpolate(
    frame,
    [fps * 2, highlightCycle],
    [0, features.length - 0.01],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const highlightIndex = Math.floor(highlightProgress);

  // Floating geometric shapes
  const shapes = [
    { x: 120, y: 180, size: 60, rotation: 45, color: "#135bec", type: "square" },
    { x: 1780, y: 220, size: 50, rotation: 0, color: "#2ecc71", type: "circle" },
    { x: 100, y: 850, size: 45, rotation: 30, color: "#f1c40f", type: "triangle" },
    { x: 1800, y: 800, size: 55, rotation: 60, color: "#e74c3c", type: "square" },
    { x: 960, y: 100, size: 40, rotation: 0, color: "#9b59b6", type: "circle" },
  ];

  // Grid lines for premium feel
  const gridOpacity = interpolate(frame, [0, fps * 0.5], [0, 0.1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0a0e17 0%, #101622 50%, #151c2c 100%)",
        fontFamily,
        overflow: "hidden",
      }}
    >
      {/* Subtle grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(19, 91, 236, ${gridOpacity}) 1px, transparent 1px),
            linear-gradient(90deg, rgba(19, 91, 236, ${gridOpacity}) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
        }}
      />

      {/* Floating shapes */}
      {shapes.map((shape, i) => {
        const floatY = Math.sin(frame * 0.03 + i * 1.5) * 15;
        const floatRotate = shape.rotation + frame * 0.3;
        const shapeOpacity = interpolate(frame - fps * 0.2 - i * 5, [0, fps * 0.4], [0, 0.2], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: shape.x,
              top: shape.y + floatY,
              width: shape.size,
              height: shape.size,
              backgroundColor: shape.type !== "triangle" ? shape.color : "transparent",
              borderRadius:
                shape.type === "circle" ? "50%" : shape.type === "square" ? shape.size / 6 : 0,
              border: shape.type === "triangle" ? `${shape.size / 2}px solid transparent` : "none",
              borderBottom:
                shape.type === "triangle" ? `${shape.size}px solid ${shape.color}` : "none",
              transform: `rotate(${floatRotate}deg)`,
              opacity: shapeOpacity,
              boxShadow: shape.type !== "triangle" ? `0 0 40px ${shape.color}40` : "none",
            }}
          />
        );
      })}

      {/* Content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "50px 80px",
          height: "100%",
        }}
      >
        {/* Title with 3D perspective */}
        <div
          style={{
            perspective: 1000,
            marginBottom: 50,
          }}
        >
          <div
            style={{
              textAlign: "center",
              transform: `translateY(${titleY}px) rotateX(${titleRotateX}deg) scale(${titleScale})`,
              transformOrigin: "center bottom",
            }}
          >
            <h1
              style={{
                fontSize: 58,
                fontWeight: 800,
                color: "white",
                marginBottom: 12,
                letterSpacing: -1,
              }}
            >
              Powerful{" "}
              <span
                style={{
                  background: "linear-gradient(135deg, #135bec 0%, #2ecc71 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Features
              </span>
            </h1>
            <p
              style={{
                fontSize: 22,
                color: "#9ca3af",
                fontWeight: 500,
              }}
            >
              Everything you need to take control of your finances
            </p>
          </div>
        </div>

        {/* Features Grid with 3D cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 28,
            width: "100%",
            maxWidth: 1400,
            perspective: 2000,
          }}
        >
          {features.map((feature, i) => {
            const { rotateY, scale, opacity, z } = getFeatureAnimation(i);
            const isHighlighted = i === highlightIndex;

            // Highlight glow animation
            const glowIntensity = isHighlighted
              ? interpolate(Math.sin((frame - highlightIndex * 20) * 0.2), [-1, 1], [0.4, 0.8])
              : 0;

            return (
              <div
                key={feature.title}
                style={{
                  transformStyle: "preserve-3d",
                  transform: `rotateY(${rotateY}deg) scale(${isHighlighted ? scale * 1.02 : scale}) translateZ(${z}px)`,
                  opacity,
                }}
              >
                <div
                  style={{
                    backgroundColor: "#1e273b",
                    borderRadius: 20,
                    padding: 28,
                    border: `2px solid ${isHighlighted ? feature.color : "#2d3748"}`,
                    boxShadow: isHighlighted
                      ? `0 0 40px ${feature.color}${Math.round(glowIntensity * 60)
                          .toString(16)
                          .padStart(2, "0")}, 0 20px 60px rgba(0,0,0,0.4)`
                      : "0 10px 40px rgba(0,0,0,0.2)",
                    position: "relative",
                    overflow: "hidden",
                    transition: "border-color 0.3s",
                  }}
                >
                  {/* Gradient overlay when highlighted */}
                  {isHighlighted && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: `linear-gradient(135deg, ${feature.color}10 0%, transparent 50%)`,
                        opacity: glowIntensity,
                      }}
                    />
                  )}

                  {/* Icon */}
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 16,
                      background: `${feature.color}20`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 20,
                      fontSize: 32,
                      position: "relative",
                      boxShadow: isHighlighted ? `0 0 30px ${feature.color}40` : "none",
                    }}
                  >
                    {feature.icon}
                  </div>

                  {/* Title */}
                  <h3
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "white",
                      marginBottom: 10,
                    }}
                  >
                    {feature.title}
                  </h3>

                  {/* Description */}
                  <p
                    style={{
                      fontSize: 15,
                      color: "#9ca3af",
                      lineHeight: 1.6,
                    }}
                  >
                    {feature.description}
                  </p>

                  {/* Accent line */}
                  <div
                    style={{
                      marginTop: 20,
                      height: 4,
                      borderRadius: 2,
                      background: feature.gradient,
                      width: isHighlighted ? "100%" : "30%",
                      transition: "width 0.4s ease-out",
                      boxShadow: isHighlighted ? `0 0 20px ${feature.color}80` : "none",
                    }}
                  />
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
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
