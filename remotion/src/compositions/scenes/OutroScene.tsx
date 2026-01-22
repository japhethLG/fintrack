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

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // ============= PREMIUM ANIMATIONS =============

  // Logo spiral entrance
  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 90, mass: 1.1 },
  });

  const logoScale = interpolate(logoProgress, [0, 1], [0, 1]);
  const logoRotate = interpolate(logoProgress, [0, 1], [360, 0]);

  // Pulsing glow
  const glowIntensity = interpolate(Math.sin(frame * 0.1), [-1, 1], [0.7, 1]);

  // Title with perspective tilt
  const titleDelay = fps * 0.4;
  const titleProgress = spring({
    frame: frame - titleDelay,
    fps,
    config: { damping: 18, stiffness: 100 },
  });

  const titleY = interpolate(titleProgress, [0, 1], [80, 0]);
  const titleRotateX = interpolate(titleProgress, [0, 1], [60, 0]);
  const titleOpacity = interpolate(titleProgress, [0, 0.3, 1], [0, 0, 1]);

  // Subtitle slide up
  const subtitleDelay = fps * 0.7;
  const subtitleProgress = spring({
    frame: frame - subtitleDelay,
    fps,
    config: { damping: 20, stiffness: 120 },
  });

  // CTA button with bounce
  const ctaDelay = fps * 1;
  const ctaProgress = spring({
    frame: frame - ctaDelay,
    fps,
    config: { damping: 10, stiffness: 80, mass: 1.2 },
  });

  const ctaScale = interpolate(ctaProgress, [0, 1], [0.3, 1]);
  const ctaOpacity = interpolate(ctaProgress, [0, 0.5, 1], [0, 0, 1]);

  // CTA hover-like pulse
  const ctaPulse = interpolate(Math.sin(frame * 0.12), [-1, 1], [1, 1.03]);

  // Stats counter animation
  const stats = [
    { value: 10000, suffix: "+", label: "Users" },
    { value: 50, suffix: "M+", label: "Tracked", prefix: "$" },
    { value: 4.9, suffix: "★", label: "Rating", decimals: 1 },
  ];

  const getStatAnimation = (index: number) => {
    const delay = fps * 1.5 + index * 10;

    const progress = spring({
      frame: frame - delay,
      fps,
      config: { damping: 15, stiffness: 100 },
    });

    const scale = interpolate(progress, [0, 1], [0.5, 1]);
    const opacity = interpolate(progress, [0, 0.3, 1], [0, 0, 1]);
    const y = interpolate(progress, [0, 1], [40, 0]);

    // Counter animation
    const countProgress = interpolate(frame - delay, [0, fps * 0.8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.quad),
    });

    return { scale, opacity, y, countProgress };
  };

  // Premium confetti with physics
  const confetti = Array.from({ length: 50 }, (_, i) => {
    const startDelay = fps * 1.2;
    const particleDelay = i * 1.5;
    const particleFrame = frame - startDelay - particleDelay;

    if (particleFrame < 0) {
      return { x: 0, y: 0, rotation: 0, opacity: 0, scale: 0, color: "#fff" };
    }

    // Physics-based trajectory
    const gravity = 0.15;
    const initialVelocityY = -15 - Math.random() * 10;
    const velocityX = (Math.random() - 0.5) * 12;

    const t = particleFrame / fps;
    const x = 960 + velocityX * particleFrame + Math.sin(t * 5 + i) * 20;
    const y =
      500 + initialVelocityY * particleFrame + 0.5 * gravity * particleFrame * particleFrame;

    const rotation = particleFrame * (5 + (i % 8));
    const opacity =
      y < 1100
        ? interpolate(y, [500, 1000], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        : 0;
    const scale = 0.5 + Math.random() * 0.5;

    const colors = ["#135bec", "#2ecc71", "#f1c40f", "#e74c3c", "#9b59b6", "#1abc9c"];
    const color = colors[i % colors.length];

    return { x, y, rotation, opacity, scale, color };
  });

  // Glowing orbs
  const orbs = [
    { x: 300, y: 300, size: 400, color: "#135bec", opacity: 0.08 },
    { x: 1600, y: 700, size: 350, color: "#2ecc71", opacity: 0.06 },
    { x: 1000, y: 900, size: 300, color: "#9b59b6", opacity: 0.05 },
  ];

  // Animated rings behind logo
  const rings = [
    { radius: 120, delay: 0, color: "#135bec" },
    { radius: 160, delay: 8, color: "#2ecc71" },
    { radius: 200, delay: 16, color: "#9b59b6" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at center, #1e273b 0%, #101622 50%, #0a0e17 100%)",
        fontFamily,
        overflow: "hidden",
      }}
    >
      {/* Glowing orbs */}
      {orbs.map((orb, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: orb.x - orb.size / 2,
            top: orb.y - orb.size / 2,
            width: orb.size,
            height: orb.size,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${orb.color} 0%, transparent 70%)`,
            opacity: orb.opacity * glowIntensity,
            filter: "blur(60px)",
          }}
        />
      ))}

      {/* Confetti particles */}
      {confetti.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: p.y,
            width: 12 * p.scale,
            height: i % 3 === 0 ? 12 * p.scale : 8 * p.scale,
            backgroundColor: p.color,
            borderRadius: i % 3 === 0 ? "50%" : i % 3 === 1 ? 2 : 0,
            transform: `rotate(${p.rotation}deg) scale(${p.scale})`,
            opacity: p.opacity,
            boxShadow: `0 0 10px ${p.color}50`,
          }}
        />
      ))}

      {/* Center Content */}
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
        {/* Animated rings */}
        {rings.map((ring, i) => {
          const ringProgress = spring({
            frame: frame - ring.delay,
            fps,
            config: { damping: 20, stiffness: 100 },
          });

          const ringScale = interpolate(ringProgress, [0, 1], [0.5, 1.3]);
          const ringOpacity = interpolate(ringProgress, [0, 0.5, 1], [0, 0.5, 0]);

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                width: ring.radius * 2,
                height: ring.radius * 2,
                borderRadius: "50%",
                border: `2px solid ${ring.color}`,
                opacity: ringOpacity * glowIntensity,
                transform: `scale(${ringScale})`,
                boxShadow: `0 0 40px ${ring.color}40`,
              }}
            />
          );
        })}

        {/* Logo */}
        <div
          style={{
            width: 110,
            height: 110,
            borderRadius: 22,
            background: "linear-gradient(135deg, #135bec 0%, #1e90ff 50%, #2ecc71 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${logoScale}) rotate(${logoRotate}deg)`,
            boxShadow: `
              0 20px 60px rgba(19, 91, 236, 0.5),
              0 0 ${80 * glowIntensity}px rgba(19, 91, 236, 0.4)
            `,
            position: "relative",
          }}
        >
          {/* Shine effect */}
          <div
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              right: 6,
              height: 30,
              borderRadius: "18px 18px 100% 100%",
              background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)",
            }}
          />
          <svg viewBox="0 0 24 24" width={56} height={56} fill="white">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
          </svg>
        </div>

        {/* Title with 3D perspective */}
        <div
          style={{
            perspective: 800,
            marginTop: 32,
          }}
        >
          <h1
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: "white",
              transform: `translateY(${titleY}px) rotateX(${titleRotateX}deg)`,
              opacity: titleOpacity,
              letterSpacing: -2,
              textShadow: "0 4px 30px rgba(0, 0, 0, 0.4)",
              transformOrigin: "center bottom",
            }}
          >
            Start Your Journey
          </h1>
        </div>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 26,
            color: "#9ca3af",
            marginTop: 12,
            transform: `translateY(${interpolate(subtitleProgress, [0, 1], [30, 0])}px)`,
            opacity: interpolate(subtitleProgress, [0, 0.5, 1], [0, 0, 1]),
            fontWeight: 500,
          }}
        >
          Take control of your financial future today
        </p>

        {/* CTA Button */}
        <div
          style={{
            marginTop: 48,
            transform: `scale(${ctaScale * ctaPulse})`,
            opacity: ctaOpacity,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #135bec 0%, #2ecc71 100%)",
              borderRadius: 16,
              padding: "20px 56px",
              boxShadow: `
                0 10px 40px rgba(19, 91, 236, 0.4),
                0 0 60px rgba(19, 91, 236, ${0.2 * glowIntensity}),
                inset 0 1px 0 rgba(255, 255, 255, 0.2)
              `,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Shine sweep */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: -100,
                width: 60,
                height: "100%",
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
                transform: `translateX(${interpolate(frame % (fps * 3), [0, fps * 3], [0, 400])}px) skewX(-20deg)`,
              }}
            />
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "white",
                letterSpacing: 0.5,
              }}
            >
              Get Started Free →
            </span>
          </div>
        </div>

        {/* Stats with counting animation */}
        <div
          style={{
            display: "flex",
            gap: 100,
            marginTop: 70,
          }}
        >
          {stats.map((stat, i) => {
            const { scale, opacity, y, countProgress } = getStatAnimation(i);
            const currentValue = stat.decimals
              ? (stat.value * countProgress).toFixed(stat.decimals)
              : Math.floor(stat.value * countProgress).toLocaleString();

            return (
              <div
                key={stat.label}
                style={{
                  textAlign: "center",
                  transform: `translateY(${y}px) scale(${scale})`,
                  opacity,
                }}
              >
                <p
                  style={{
                    fontSize: 44,
                    fontWeight: 800,
                    color: "#135bec",
                    textShadow: "0 0 30px rgba(19, 91, 236, 0.5)",
                  }}
                >
                  {stat.prefix || ""}
                  {currentValue}
                  {stat.suffix}
                </p>
                <p
                  style={{
                    fontSize: 16,
                    color: "#9ca3af",
                    marginTop: 4,
                    fontWeight: 500,
                  }}
                >
                  {stat.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom gradient bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 6,
          background: "linear-gradient(90deg, #135bec 0%, #2ecc71 33%, #f1c40f 66%, #e74c3c 100%)",
          opacity: interpolate(ctaProgress, [0, 1], [0, 1]),
          boxShadow: "0 0 30px rgba(19, 91, 236, 0.6)",
        }}
      />

      {/* Website URL */}
      <div
        style={{
          position: "absolute",
          bottom: 36,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: interpolate(ctaProgress, [0, 1], [0, 1]),
        }}
      >
        <p
          style={{
            fontSize: 18,
            color: "#6c757d",
            fontWeight: 500,
            letterSpacing: 1,
          }}
        >
          fintrack.app
        </p>
      </div>

      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
