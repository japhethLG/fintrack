"use client";

import React from "react";
import { LandingNavbar } from "./components/LandingNavbar";
import { LandingHero } from "./components/LandingHero";
import { LandingFeatures } from "./components/LandingFeatures";
import { LandingProductTour } from "./components/LandingProductTour";
import { LandingHowItWorks } from "./components/LandingHowItWorks";
import { LandingFAQ } from "./components/LandingFAQ";
import { LandingCTA } from "./components/LandingCTA";
import { LandingFooter } from "./components/LandingFooter";

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen overflow-y-auto bg-dark-900 scroll-smooth">
      <LandingNavbar />
      <main>
        <LandingHero />
        <LandingFeatures />
        <LandingProductTour />
        <LandingHowItWorks />
        <LandingFAQ />
        <LandingCTA />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;
