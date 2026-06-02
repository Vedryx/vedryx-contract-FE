import { Nav } from '../../components/layout/Navbar/Navbar.jsx'
import { SiteFooter } from '../../components/layout/SiteFooter/SiteFooter.jsx'
import { ClosingSection } from '../../components/sections/ClosingSection/ClosingSection.jsx'
import { ComparisonScene } from '../../components/sections/ComparisonScene/ComparisonScene.jsx'
import { DecisionPathSection } from '../../components/sections/DecisionPathSection/DecisionPathSection.jsx'
import { EngineSection } from '../../components/sections/EngineSection/EngineSection.jsx'
import { HeroSection } from '../../components/sections/HeroSection/HeroSection.jsx'
import { RiskFreeSection } from '../../components/sections/RiskFreeSection/RiskFreeSection.jsx'
import { StackSection } from '../../components/sections/StackSection/StackSection.jsx'
import { TrustLayer } from '../../components/sections/TrustLayer/TrustLayer.jsx'
import { WhySection } from '../../components/sections/WhySection/WhySection.jsx'
import { usePageMotion } from '../../hooks/usePageMotion.js'

export function LandingPage() {
  usePageMotion()

  return (
    <>
      <Nav />
      <HeroSection />
      <TrustLayer />
      <ComparisonScene />
      <EngineSection />
      <RiskFreeSection />
      <DecisionPathSection />
      <StackSection />
      <WhySection />
      <ClosingSection />
      <SiteFooter />
    </>
  )
}
