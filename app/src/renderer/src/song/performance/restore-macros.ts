import { macroProblems, type MidiMacro } from "./midi-macros";

/** Keep the local definition whenever the same code has a different definition in the archive. */
export function planMacroRestore(local: readonly MidiMacro[], saved: readonly MidiMacro[]) {
  const known = new Map(local.map((macro) => [macro.code, macro]));
  const conflicts = new Set<string>();
  for (const macro of saved) {
    const previous = known.get(macro.code);
    if (!previous) known.set(macro.code, macro);
    else if (JSON.stringify(previous.commands) !== JSON.stringify(macro.commands)) conflicts.add(macro.code);
  }
  const added = [...known.values()].filter((macro) => !local.some(({ code }) => code === macro.code) && !conflicts.has(macro.code));
  const macros = [...local, ...added];
  return { added, macros, conflicts: [...conflicts], errors: added.length ? macroProblems(macros) : [] };
}
