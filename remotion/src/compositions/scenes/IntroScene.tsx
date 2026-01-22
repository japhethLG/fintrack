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

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ============= PREMIUM ANIMATIONS =============

  // Logo entrance with overshoot bounce
  const logoEntrance = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 1.2 },
  });

  const logoScale = interpolate(logoEntrance, [0, 1], [0, 1]);
  const logoRotateZ = interpolate(logoEntrance, [0, 0.5, 1], [180, -10, 0]);

  // Pulsing glow effect
  const glowPulse = interpolate(Math.sin(frame * 0.08), [-1, 1], [0.6, 1]);

  // Title reveal with stagger
  const titleDelay = fps * 0.6;
  const titleProgress = spring({
    frame: frame - titleDelay,
    fps,
    config: { damping: 20, stiffness: 100 },
  });

  const titleY = interpolate(titleProgress, [0, 1], [60, 0]);
  const titleOpacity = interpolate(titleProgress, [0, 0.3, 1], [0, 0, 1]);

  // "Fin" and "Track" split animation
  const finDelay = titleDelay;
  const trackDelay = titleDelay + 6;

  const finProgress = spring({
    frame: frame - finDelay,
    fps,
    config: { damping: 18, stiffness: 120 },
  });

  const trackProgress = spring({
    frame: frame - trackDelay,
    fps,
    config: { damping: 18, stiffness: 120 },
  });

  const finX = interpolate(finProgress, [0, 1], [-50, 0]);
  const trackX = interpolate(trackProgress, [0, 1], [50, 0]);
  const finOpacity = interpolate(finProgress, [0, 0.3, 1], [0, 0, 1]);
  const trackOpacity = interpolate(trackProgress, [0, 0.3, 1], [0, 0, 1]);

  // Subtitle typewriter effect
  const subtitleText = "Master Your Financial Future";
  const subtitleDelay = fps * 1.2;
  const typingProgress = interpolate(
    frame - subtitleDelay,
    [0, fps * 1.5],
    [0, subtitleText.length],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const visibleSubtitle = subtitleText.slice(0, Math.floor(typingProgress));
  const cursorOpacity = Math.sin(frame * 0.3) > 0 ? 1 : 0;

  // Tagline items with sophisticated stagger
  const taglines = ["Track", "Forecast", "Succeed"];
  const taglineColors = ["#135bec", "#2ecc71", "#f1c40f"];

  const getTaglineAnimation = (index: number) => {
    const delay = fps * 2.2 + index * 12;
    const progress = spring({
      frame: frame - delay,
      fps,
      config: { damping: 15, stiffness: 100 },
    });

    const x = interpolate(progress, [0, 1], [index % 2 === 0 ? -40 : 40, 0]);
    const scale = interpolate(progress, [0, 1], [0.5, 1]);
    const opacity = interpolate(progress, [0, 0.3, 1], [0, 0, 1]);
    const rotateY = interpolate(progress, [0, 1], [index % 2 === 0 ? -45 : 45, 0]);

    return { x, scale, opacity, rotateY };
  };

  // Floating rings with 3D perspective
  const rings = [
    { radius: 200, speed: 0.02, thickness: 2, color: "#135bec", rotateX: 60 },
    { radius: 250, speed: -0.015, thickness: 1.5, color: "#2ecc71", rotateX: 70 },
    { radius: 300, speed: 0.01, thickness: 1, color: "#9b59b6", rotateX: 75 },
  ];

  // Premium particles with depth
  const particles = Array.from({ length: 30 }, (_, i) => {
    const layer = i % 3; // 0 = far, 1 = mid, 2 = near
    const baseSize = layer === 0 ? 2 : layer === 1 ? 4 : 6;
    const speed = layer === 0 ? 0.3 : layer === 1 ? 0.5 : 0.8;

    const startX = (i * 67) % 1920;
    const startY = 1200 + i * 30;

    const particleFrame = frame - i * 3;
    const progress = interpolate(particleFrame * speed, [0, fps * 6], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "extend",
    });

    const y = interpolate(progress % 1, [0, 1], [startY, -100]);
    const x = startX + Math.sin(progress * 10 + i) * (30 + layer * 10);
    const opacity = interpolate(
      progress % 1,
      [0, 0.1, 0.5, 0.9, 1],
      [0, 0.3 + layer * 0.2, 0.5 + layer * 0.2, 0.3 + layer * 0.2, 0]
    );

    const colors = ["#135bec", "#2ecc71", "#9b59b6", "#f1c40f"];
    const color = colors[i % colors.length];

    return { x, y, opacity, size: baseSize, color, blur: layer === 0 ? 2 : layer === 1 ? 1 : 0 };
  });

  // Gradient bar animation
  const gradientProgress = interpolate(frame, [fps * 2.5, fps * 3.5], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at center, #151c2c 0%, #0a0e17 70%)",
        fontFamily,
        overflow: "hidden",
      }}
    >
      {/* Premium particles with depth */}
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            backgroundColor: p.color,
            opacity: p.opacity,
            boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
            filter: p.blur > 0 ? `blur(${p.blur}px)` : undefined,
          }}
        />
      ))}

      {/* 3D Rotating rings */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          transform: "translate(-50%, -50%)",
          perspective: 1000,
        }}
      >
        {rings.map((ring, i) => {
          const rotation = frame * ring.speed * 50;
          const ringOpacity = interpolate(frame, [fps * 0.3 + i * 8, fps * 0.8 + i * 8], [0, 0.4], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: ring.radius * 2,
                height: ring.radius * 2,
                marginLeft: -ring.radius,
                marginTop: -ring.radius,
                border: `${ring.thickness}px solid ${ring.color}`,
                borderRadius: "50%",
                opacity: ringOpacity * glowPulse,
                transform: `rotateX(${ring.rotateX}deg) rotateZ(${rotation}deg)`,
                boxShadow: `0 0 30px ${ring.color}40, inset 0 0 20px ${ring.color}20`,
              }}
            />
          );
        })}
      </div>

      {/* Center content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Glowing orb behind logo */}
        <div
          style={{
            position: "absolute",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(19, 91, 236, ${0.15 * glowPulse}) 0%, transparent 70%)`,
            transform: `scale(${logoScale})`,
            filter: "blur(40px)",
          }}
        />

        {/* Logo with 3D effect */}
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: 28,
            background: "linear-gradient(135deg, #135bec 0%, #1e90ff 50%, #2ecc71 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${logoScale}) rotateZ(${logoRotateZ}deg)`,
            boxShadow: `
              0 20px 60px rgba(19, 91, 236, 0.5),
              0 0 80px rgba(19, 91, 236, ${0.3 * glowPulse}),
              inset 0 2px 20px rgba(255, 255, 255, 0.2)
            `,
            position: "relative",
          }}
        >
          {/* Inner shine */}
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              right: 8,
              height: 40,
              borderRadius: "24px 24px 100% 100%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 100%)",
            }}
          />
          <svg viewBox="0 0 24 24" width={72} height={72} fill="white">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
          </svg>
        </div>

        {/* Title with split animation */}
        <div
          style={{
            fontSize: 110,
            fontWeight: 800,
            marginTop: 36,
            letterSpacing: -3,
            display: "flex",
            perspective: 500,
          }}
        >
          <span
            style={{
              color: "#135bec",
              transform: `translateX(${finX}px) rotateY(${interpolate(finProgress, [0, 1], [-30, 0])}deg)`,
              opacity: finOpacity,
              textShadow: "0 0 60px rgba(19, 91, 236, 0.5)",
            }}
          >
            Fin
          </span>
          <span
            style={{
              color: "white",
              transform: `translateX(${trackX}px) rotateY(${interpolate(trackProgress, [0, 1], [30, 0])}deg)`,
              opacity: trackOpacity,
              textShadow: "0 4px 30px rgba(0, 0, 0, 0.3)",
            }}
          >
            Track
          </span>
        </div>

        {/* Typewriter subtitle */}
        <div
          style={{
            fontSize: 32,
            color: "#9ca3af",
            marginTop: 16,
            fontWeight: 500,
            minHeight: 40,
          }}
        >
          {visibleSubtitle}
          <span
            style={{
              display: "inline-block",
              width: 3,
              height: 28,
              backgroundColor: "#135bec",
              marginLeft: 4,
              opacity: typingProgress < subtitleText.length ? cursorOpacity : 0,
              transform: "translateY(4px)",
            }}
          />
        </div>

        {/* Taglines with 3D perspective */}
        <div
          style={{
            display: "flex",
            gap: 50,
            marginTop: 60,
            perspective: 800,
          }}
        >
          {taglines.map((text, i) => {
            const anim = getTaglineAnimation(i);
            return (
              <div
                key={text}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  transform: `translateX(${anim.x}px) scale(${anim.scale}) rotateY(${anim.rotateY}deg)`,
                  opacity: anim.opacity,
                  transformStyle: "preserve-3d",
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    backgroundColor: taglineColors[i],
                    boxShadow: `0 0 20px ${taglineColors[i]}`,
                  }}
                />
                <span
                  style={{
                    fontSize: 22,
                    color: "white",
                    fontWeight: 600,
                    letterSpacing: 0.5,
                  }}
                >
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom gradient bar with reveal animation */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 5,
          background: `linear-gradient(90deg,
            #135bec 0%,
            #2ecc71 33%,
            #f1c40f 66%,
            #e74c3c 100%
          )`,
          clipPath: `inset(0 ${100 - gradientProgress}% 0 0)`,
          boxShadow: "0 0 30px rgba(19, 91, 236, 0.5)",
        }}
      />

      {/* Vignette overlay for premium feel */}
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
