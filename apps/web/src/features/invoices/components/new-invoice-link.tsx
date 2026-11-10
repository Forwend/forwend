import { Button, type ButtonSize, type ButtonVariant, buttonClasses } from "@forwend/ui-web";
import { Plus } from "lucide-react";
import Link from "next/link";
import { INVOICES_COPY, REQUESTS_COPY } from "@/features/invoices/constants/invoices-copy";
import { APP_ROUTES } from "@/shared/config/routes";

export interface NewInvoiceLinkProps {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** A personal profile's invoices are requests: New request opens the request page. */
  onRequest?: () => void;
}

export function NewInvoiceLink({
  className = "",
  size = "md",
  variant,
  onRequest,
}: NewInvoiceLinkProps) {
  const icon = <Plus aria-hidden className="size-[var(--fw-icon-sm)]" />;
  return onRequest ? (
    <Button size={size} variant={variant} onClick={onRequest} className={className}>
      {icon}
      {REQUESTS_COPY.newInvoice}
    </Button>
  ) : (
    <Link
      href={APP_ROUTES.newInvoice}
      className={`${buttonClasses({ size, variant })} ${className}`}
    >
      {icon}
      {INVOICES_COPY.newInvoice}
    </Link>
  );
}
