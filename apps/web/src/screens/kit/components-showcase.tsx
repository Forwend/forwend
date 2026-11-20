import { ButtonsShowcase } from "@/screens/kit/buttons-showcase";
import { DatesShowcase } from "@/screens/kit/dates-showcase";
import { DisplayShowcase } from "@/screens/kit/display-showcase";
import { FeedbackShowcase } from "@/screens/kit/feedback-showcase";
import { FieldsShowcase } from "@/screens/kit/fields-showcase";
import { ListControlsShowcase } from "@/screens/kit/list-controls-showcase";
import { OverlaysShowcase } from "@/screens/kit/overlays-showcase";

export function ComponentsShowcase() {
  return (
    <div className="flex flex-col gap-10">
      <ButtonsShowcase />
      <ListControlsShowcase />
      <OverlaysShowcase />
      <DatesShowcase />
      <FieldsShowcase />
      <DisplayShowcase />
      <FeedbackShowcase />
    </div>
  );
}
