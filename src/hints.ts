/** Extract actual spellings, never generated descriptions. Hints are deliberately incomplete. */
export function hiddenReferences(text: string): string {
    const tokens = text.match(/[A-Za-z_$][\w$./:-]*/g) ?? [];
    const refs = [...new Set(tokens.filter(t => t.length <= 80 && (/[a-z][A-Z]/.test(t) || /[A-Z]+_[A-Z]+/.test(t) || /\w[/.]\w/.test(t))))].slice(0, 6);
    return refs.length ? ` Hidden references (partial): ${refs.join(", ")}.` : "";
}
