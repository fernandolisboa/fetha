import { t } from "../strings";
import { buildLinkEmail, type LinkEmail } from "./link-email";

export type MagicLinkEmail = LinkEmail;

export function buildMagicLinkEmail(url: string): MagicLinkEmail {
  return buildLinkEmail(t.magicLinkEmail, url);
}
