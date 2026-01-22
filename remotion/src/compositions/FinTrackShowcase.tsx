import { TransitionSeries, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { flip } from "@remotion/transitions/flip";
import { useVideoConfig, AbsoluteFill, interpolate, useCurrentFrame, spring } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { DashboardScene } from "./scenes/DashboardScene";
import { FeaturesScene } from "./scenes/FeaturesScene";
import { CalendarScene } from "./scenes/CalendarScene";
import { AIInsightsScene } from "./scenes/AIInsightsScene";
import { OutroScene } from "./scenes/OutroScene";

// Premium ambient particles overlay
const AmbientParticles: React.FC = () => {
  const frame = useCurrentFrame();

  const particles = Array.from({ length: 15 }, (_, i) => {
    const speed = 0.3 + (i % 5) * 0.1;
    const baseX = 100 + ((i * 127) % 1700);
    const baseY = 100 + ((i * 89) % 900);

    const floatX = Math.sin(frame * speed * 0.02 + i * 0.5) * 30;
    const floatY = Math.cos(frame * speed * 0.015 + i * 0.7) * 20;

    const opacity = interpolate(Math.sin(frame * 0.02 + i), [-1, 1], [0.03, 0.1]);

    const size = 3 + (i % 4) * 2;
    const colors = ["#135bec", "#2ecc71", "#9b59b6"];
    const color = colors[i % colors.length];

    return { x: baseX + floatX, y: baseY + floatY, opacity, size, color };
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
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
            boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
            filter: "blur(1px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

export const FinTrackShowcase: React.FC = () => {
  const { fps } = useVideoConfig();

  // Smooth spring transition timing
  const smoothTransition = springTiming({
    config: { damping: 200 },
    durationInFrames: Math.floor(0.6 * fps),
  });

  const flipTransition = springTiming({
    config: { damping: 25, stiffness: 100 },
    durationInFrames: Math.floor(0.8 * fps),
  });

  return (
    <AbsoluteFill style={{ background: "#0a0e17" }}>
      <TransitionSeries>
        {/* Scene 1: Intro - 4.5 seconds */}
        <TransitionSeries.Sequence durationInFrames={Math.floor(4.5 * fps)}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={smoothTransition} />

        {/* Scene 2: Dashboard - 7 seconds (longer for 3D zoom animation) */}
        <TransitionSeries.Sequence durationInFrames={7 * fps}>
          <DashboardScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={flip({ direction: "from-left" })}
          timing={flipTransition}
        />

        {/* Scene 3: Features - 5.5 seconds */}
        <TransitionSeries.Sequence durationInFrames={Math.floor(5.5 * fps)}>
          <FeaturesScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={smoothTransition}
        />

        {/* Scene 4: Calendar - 5 seconds */}
        <TransitionSeries.Sequence durationInFrames={5 * fps}>
          <CalendarScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={flip({ direction: "from-right" })}
          timing={flipTransition}
        />

        {/* Scene 5: AI Insights - 5 seconds */}
        <TransitionSeries.Sequence durationInFrames={5 * fps}>
          <AIInsightsScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition presentation={fade()} timing={smoothTransition} />

        {/* Scene 6: Outro - 4 seconds */}
        <TransitionSeries.Sequence durationInFrames={4 * fps}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Subtle ambient particles overlay */}
      <AmbientParticles />
    </AbsoluteFill>
  );
};
