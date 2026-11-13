import { LandingNav, Footer } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { CtaBand, FaqSection, FeaturesSection } from "@/components/landing/features";
import {
  ContractsSection,
  HowSection,
  RiskSection,
  StrategiesSection,
} from "@/components/landing/sections";

export default function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <StrategiesSection />
        <FeaturesSection />
        <HowSection />
        <RiskSection />
        <FaqSection />
        <CtaBand />
        <ContractsSection />
      </main>
      <Footer />
    </>
  );
}
