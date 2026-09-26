import { buttonVariants } from "@/components/ui/button";

import { t } from "../strings";

export const ACCOUNT_EXPORT_PATH = "/api/account/export";

export function ExportDataLink() {
  return (
    <a href={ACCOUNT_EXPORT_PATH} download className={buttonVariants({ variant: "outline" })}>
      {t.dataExport.action}
    </a>
  );
}
