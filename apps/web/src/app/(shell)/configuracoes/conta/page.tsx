import Link from "next/link";

import { ExportDataLink, t as accountStrings } from "@/modules/account";
import { AccessLogPanel, getMyAccessLog, groupAccessLog, t as auditStrings } from "@/modules/audit";
import { DeleteAccountDialog, requireUser, SignOutButton, t as authStrings } from "@/modules/auth";

import { SettingsSection } from "../_components/settings-section";

export default async function AccountSettingsPage() {
  await requireUser();
  const accessLogGroups = groupAccessLog(await getMyAccessLog());

  return (
    <div className="@container flex flex-col gap-[14px]">
      <div className="grid items-start gap-[14px] @min-[50rem]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-[14px]">
          <SettingsSection
            title={accountStrings.dataExport.title}
            subtitle={accountStrings.dataExport.subtitle}
          >
            <div>
              <ExportDataLink />
            </div>
            <p className="text-muted-foreground text-xs">
              <Link href="/termos" className="underline underline-offset-4">
                {authStrings.terms.title}
              </Link>
              {" · "}
              <Link href="/privacidade" className="underline underline-offset-4">
                {authStrings.privacy.title}
              </Link>
            </p>
          </SettingsSection>

          <SettingsSection
            title={authStrings.deleteAccount.title}
            subtitle={authStrings.deleteAccount.subtitle}
          >
            <div>
              <DeleteAccountDialog />
            </div>
          </SettingsSection>
        </div>

        <SettingsSection
          title={auditStrings.accessLog.title}
          subtitle={auditStrings.accessLog.subtitle}
          className="min-w-0"
        >
          <AccessLogPanel groups={accessLogGroups} />
        </SettingsSection>
      </div>

      <div>
        <SignOutButton />
      </div>
    </div>
  );
}
