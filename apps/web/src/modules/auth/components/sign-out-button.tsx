import { Button } from "@/components/ui/button";

import { signOutAction } from "../actions";
import { t } from "../strings";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline">
        {t.signOut}
      </Button>
    </form>
  );
}
