// The active NDE rule set, loaded once per sign-in and shared with every screen
// that shows a driver picklist, a requirement, or a coverage spec. The rule set
// is data (Settings → Examination rules); nothing in the interface hard-codes a
// service category, material group, flange class, code or percentage any more.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, logErr } from "./api";
import { useAuth } from "./auth";
import type { NdeRuleSet } from "./types";
import { setNdeRuleSet } from "./version";

export interface NdeRulesCtx {
  /** The active rule set, or null until it has loaded. */
  rules: NdeRuleSet | null;
  /** Re-read the active rule set (after activating another one). */
  refresh: () => Promise<void>;
  // ---- vocabularies, in the rule set's order ----
  materialGroups: string[];
  serviceCategories: string[];
  flangeClasses: string[];
  codes: { key: string; label: string; isDefault: boolean }[];
  defaultCode: string;
  /** [value, label] pairs for the shop/field picker, from the rule set's match terms. */
  shopField: [string, string][];
  /** Coverage spec labels ("5%", …, "API 570"). */
  specLabels: string[];
  /** Short name used in copy: "Table 4 requires …". */
  tableLabel: string;
  /** Long name for footers and PDFs. */
  ruleSetName: string;
  /** The id stamped on welds and exports, e.g. "EP-5-5-1-R0.4". */
  ruleSetId: string;
}

const Ctx = createContext<NdeRulesCtx | null>(null);

/** The first match term of a vocabulary, as a stored value ("=SHOP" → "SHOP"). */
function firstTerm(terms: string[] | undefined, fallback: string): string {
  const t = (terms ?? []).map((s) => s.trim().replace(/^=/, "")).find((s) => s.length > 0);
  return t ?? fallback;
}

export function deriveVocab(rules: NdeRuleSet | null): Omit<NdeRulesCtx, "rules" | "refresh"> {
  if (!rules) {
    return {
      materialGroups: [], serviceCategories: [], flangeClasses: [], codes: [], defaultCode: "B31.3",
      shopField: [["SHOP", "Shop"], ["FW", "Field"]], specLabels: [],
      tableLabel: "the examination rules", ruleSetName: "", ruleSetId: "",
    };
  }
  const shop = firstTerm(rules.locations?.shop, "SHOP");
  const field = firstTerm(rules.locations?.field, "FW");
  return {
    materialGroups: rules.materials.map((m) => m.key),
    serviceCategories: rules.services.map((s) => s.key),
    flangeClasses: rules.flange_classes,
    codes: rules.codes.map((c) => ({ key: c.key, label: c.label, isDefault: c.is_default })),
    defaultCode: rules.codes.find((c) => c.is_default)?.key ?? rules.codes[0]?.key ?? "",
    shopField: [[shop, "Shop"], [field, "Field"]],
    specLabels: rules.specs.map((s) => s.label),
    tableLabel: rules.table_label || rules.name,
    ruleSetName: rules.name,
    ruleSetId: rules.id,
  };
}

export function NdeRulesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [rules, setRules] = useState<NdeRuleSet | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await api.ndeRulesActive();
      setRules(r);
      setNdeRuleSet(r.id);
    } catch (e) {
      logErr("loading the NDE rule set")(e);
    }
  }, []);
  // Loaded per sign-in (the command needs a session) and dropped on sign-out.
  useEffect(() => {
    if (user) void refresh();
    else setRules(null);
  }, [user?.id, user, refresh]);
  const value = useMemo<NdeRulesCtx>(() => ({ rules, refresh, ...deriveVocab(rules) }), [rules, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The active rule set and its vocabularies. Safe outside the provider (empty lists). */
export function useNdeRules(): NdeRulesCtx {
  const v = useContext(Ctx);
  return v ?? { rules: null, refresh: async () => {}, ...deriveVocab(null) };
}
