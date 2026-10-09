import { SiteFooter } from "@/screens/landing/layout/site-footer";
import { SiteNav } from "@/screens/landing/layout/site-nav";
import { CheckoutPreview } from "@/screens/landing/sections/checkout-preview/checkout-preview";
import { Developers } from "@/screens/landing/sections/developers";
import { Faq } from "@/screens/landing/sections/faq";
import { Fees } from "@/screens/landing/sections/fees";
import { FinalCta } from "@/screens/landing/sections/final-cta";
import { Hero } from "@/screens/landing/sections/hero/hero";
import { HowItWorks } from "@/screens/landing/sections/how-it-works";
import { MoneyRules } from "@/screens/landing/sections/money-rules";
import { Networks } from "@/screens/landing/sections/networks";
import { ProfilePreview } from "@/screens/landing/sections/profile-preview/profile-preview";

export function LandingScreen() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <Networks />
        <HowItWorks />
        <ProfilePreview />
        <CheckoutPreview />
        <MoneyRules />
        <Developers />
        <Fees />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
