import { Composition, Folder } from "remotion";
import { FinTrackShowcase } from "./compositions/FinTrackShowcase";
import { IntroScene } from "./compositions/scenes/IntroScene";
import { DashboardScene } from "./compositions/scenes/DashboardScene";
import { FeaturesScene } from "./compositions/scenes/FeaturesScene";
import { CalendarScene } from "./compositions/scenes/CalendarScene";
import { AIInsightsScene } from "./compositions/scenes/AIInsightsScene";
import { OutroScene } from "./compositions/scenes/OutroScene";

// Video settings
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

export const RemotionRoot = () => {
  return (
    <>
      {/* Main Showcase Video */}
      <Composition
        id="FinTrackShowcase"
        component={FinTrackShowcase}
        durationInFrames={35 * FPS} // 35 seconds (with longer dashboard scene)
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      {/* Individual Scenes for Preview */}
      <Folder name="Scenes">
        <Composition
          id="IntroScene"
          component={IntroScene}
          durationInFrames={5 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="DashboardScene"
          component={DashboardScene}
          durationInFrames={7 * FPS} // Extended for 3D zoom animation
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="FeaturesScene"
          component={FeaturesScene}
          durationInFrames={6 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="CalendarScene"
          component={CalendarScene}
          durationInFrames={5 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="AIInsightsScene"
          component={AIInsightsScene}
          durationInFrames={5 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="OutroScene"
          component={OutroScene}
          durationInFrames={4 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      </Folder>
    </>
  );
};
