import type { EvaCourseContents, EvaModule, EvaSection } from '../domain/types.js';

export type OutlineEntry =
  | { type: 'section'; section: EvaSection }
  | { type: 'module'; section: EvaSection; module: EvaModule };

export function flattenOutline(contents: EvaCourseContents): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const section of contents.sections) {
    entries.push({ type: 'section', section });
    for (const module of section.modules) {
      entries.push({ type: 'module', section, module });
    }
  }
  return entries;
}

export function moduleTag(modname: string): string {
  return `[${modname || 'actividad'}]`;
}
