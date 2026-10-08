import { Button } from "@forwend/ui-web";
import { SITE } from "@/constants/site";

// Placeholder home page. F006 builds the landing page.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 p-6">
      <h1 className="text-4xl font-semibold">{SITE.name}</h1>
      <p>{SITE.description}</p>
      <Button>Join waitlist</Button>
    </main>
  );
}
