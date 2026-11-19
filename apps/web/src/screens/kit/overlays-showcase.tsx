"use client";

import {
  BUTTON_VARIANTS,
  Button,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Sheet,
  Skeleton,
  StepTransition,
} from "@forwend/ui-web";
import { Moon, Plus } from "lucide-react";
import { useState } from "react";
import { KitGroup } from "@/screens/kit/kit-section";

export function OverlaysShowcase() {
  const [menuChoice, setMenuChoice] = useState("personal");
  const [menuDark, setMenuDark] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [wideOpen, setWideOpen] = useState(false);
  return (
    <KitGroup title="Menu and sheet">
      <Menu>
        <MenuTrigger asChild>
          <Button variant={BUTTON_VARIANTS.secondary}>Open menu</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Profiles</MenuLabel>
          <MenuRadioGroup value={menuChoice} onValueChange={setMenuChoice}>
            <MenuRadioItem value="personal">Personal</MenuRadioItem>
            <MenuRadioItem value="merchant">Merchant · Studio Lumen</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem>
            <Plus aria-hidden className="size-[var(--fw-icon-md)]" />
            New profile
          </MenuItem>
          <MenuItem disabled>Unavailable item</MenuItem>
          <MenuSeparator />
          <MenuCheckboxItem checked={menuDark} onCheckedChange={setMenuDark}>
            <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
            Dark mode
          </MenuCheckboxItem>
        </MenuContent>
      </Menu>
      <Button variant={BUTTON_VARIANTS.secondary} onClick={() => setSheetOpen(true)}>
        Open sheet
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Receive">
        <p className="text-muted">A bottom sheet on phones, a centered panel from sm up.</p>
      </Sheet>
      <Button variant={BUTTON_VARIANTS.secondary} onClick={() => setWideOpen(true)}>
        Open wide sheet
      </Button>
      <Sheet open={wideOpen} onOpenChange={setWideOpen} title="Pay with another token" size="lg">
        <p className="text-muted">
          Size lg: two columns from sm up, such as chains beside their tokens.
        </p>
      </Sheet>
      <StepsDemo />
    </KitGroup>
  );
}

const DEMO_STEPS = ["Short step", "Taller step", "Shortest"] as const;

function StepsDemo() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [locked, setLocked] = useState(false);
  const move = (by: 1 | -1) => setIndex((i) => i + by);
  return (
    <>
      <Button
        variant={BUTTON_VARIANTS.secondary}
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
      >
        Open stepped sheet
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={DEMO_STEPS[index] ?? ""}
        onBack={index > 0 && !locked ? () => move(-1) : undefined}
        locked={locked}
      >
        <StepTransition step={String(index)} label={DEMO_STEPS[index] ?? ""}>
          <div className="flex flex-col gap-3">
            {Array.from({ length: index === 1 ? 6 : index === 0 ? 3 : 1 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows, one per position
              <Skeleton key={i} className="h-10" />
            ))}
            {index === DEMO_STEPS.length - 1 ? (
              <Button
                className="w-full"
                loading={locked}
                onClick={() => {
                  setLocked(true);
                  setTimeout(() => setLocked(false), 3000);
                }}
              >
                Lock for 3 s
              </Button>
            ) : (
              <Button className="w-full" onClick={() => move(1)}>
                Continue
              </Button>
            )}
          </div>
        </StepTransition>
      </Sheet>
    </>
  );
}
