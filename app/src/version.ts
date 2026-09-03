// App identity used to stamp exported records so an audit can tell exactly
// which build and rule set produced a report.
export const APP_NAME = "SENTRIX Assurance Console";
export const APP_VERSION = "0.2.0";
// The active NDE rule set's id. The rule set is data (Settings → Examination
// rules); this live binding is refreshed when it loads so exports and PDFs stamp
// the revision actually in force, not a compiled-in default.
export let NDE_RULE_SET = "EP-5-5-1-R0.4";
export function setNdeRuleSet(id: string) {
  if (id && id.trim()) NDE_RULE_SET = id.trim();
}
