import { randomBytes } from "node:crypto";

export type IdPrefix = "wks_" | "usr_" | "agt_" | "tok_" | "svc_" | "hlr_" | "cfg_" | "act_" | "cmd_" | "crs_" | "aud_" | "set_";

export function newId<P extends IdPrefix>(prefix: P): `${P}${string}` {
  return `${prefix}${randomBytes(12).toString("base64url")}` as `${P}${string}`;
}
