import { CheckoutPreview } from "@/components/landing/checkout-preview";
import { Developers } from "@/components/landing/developers";
import { Faq } from "@/components/landing/faq";
import { Fees } from "@/components/landing/fees";
import { FinalCta } from "@/components/landing/final-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { MoneyRules } from "@/components/landing/money-rules";
import { Networks } from "@/components/landing/networks";
import { Profiles } from "@/components/landing/profiles";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteNav } from "@/components/landing/site-nav";

export default function HomePage() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <Networks />
        <HowItWorks />
        <Profiles />
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
