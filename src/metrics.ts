import { LABELS, type Label, type Prediction } from "./types.ts";

export interface Row {
	key: string;
	category: string;
	truth: Label;
	acceptable: Label[];
	critical: boolean;
	pred: Prediction;
	/** Tokens of the item's result, for savings estimates. */
	tokens: number;
	/** Tokens a truncation would keep (key lines budget). */
	truncatedTokens: number;
}

export const PREDICTIONS: Prediction[] = [...LABELS, "UNCERTAIN"];

export type Confusion = Record<Label, Record<Prediction, number>>;

export function confusion(rows: Row[]): Confusion {
	const m = Object.fromEntries(LABELS.map((t) => [t, Object.fromEntries(PREDICTIONS.map((p) => [p, 0]))])) as Confusion;
	for (const r of rows) m[r.truth][r.pred]++;
	return m;
}

const ratio = (num: number, den: number) => (den === 0 ? Number.NaN : num / den);

export interface Summary {
	n: number;
	accuracy: number;
	lenientAccuracy: number;
	keepRecall: number;
	/** Items whose truth is not DROP and that were not dropped. */
	retention: number;
	criticalFalseDropRate: number;
	criticalFalseDrops: string[];
	falseDropRate: number;
	truncateAccuracy: number;
	dropPrecision: number;
	dropRecall: number;
	uncertainRate: number;
	tokenSavings: number;
	confusion: Confusion;
}

export function summarize(rows: Row[]): Summary {
	const count = (f: (r: Row) => boolean) => rows.filter(f).length;
	const critical = rows.filter((r) => r.critical);
	const noDrop = rows.filter((r) => !r.acceptable.includes("DROP"));
	const predDrop = rows.filter((r) => r.pred === "DROP");
	const total = rows.reduce((s, r) => s + r.tokens, 0);
	const saved = rows.reduce((s, r) => s + (r.pred === "DROP" ? r.tokens : r.pred === "TRUNCATE" ? Math.max(0, r.tokens - r.truncatedTokens) : 0), 0);
	return {
		n: rows.length,
		accuracy: ratio(count((r) => r.pred === r.truth), rows.length),
		lenientAccuracy: ratio(count((r) => r.acceptable.includes(r.pred as Label)), rows.length),
		keepRecall: ratio(count((r) => r.truth === "KEEP" && r.pred === "KEEP"), count((r) => r.truth === "KEEP")),
		retention: ratio(count((r) => r.truth !== "DROP" && r.pred !== "DROP"), count((r) => r.truth !== "DROP")),
		criticalFalseDropRate: ratio(critical.filter((r) => r.pred === "DROP").length, critical.length),
		criticalFalseDrops: [...new Set(critical.filter((r) => r.pred === "DROP").map((r) => r.key))],
		falseDropRate: ratio(noDrop.filter((r) => r.pred === "DROP").length, noDrop.length),
		truncateAccuracy: ratio(count((r) => r.truth === "TRUNCATE" && r.pred === "TRUNCATE"), count((r) => r.truth === "TRUNCATE")),
		dropPrecision: ratio(predDrop.filter((r) => r.acceptable.includes("DROP")).length, predDrop.length),
		dropRecall: ratio(count((r) => r.truth === "DROP" && r.pred === "DROP"), count((r) => r.truth === "DROP")),
		uncertainRate: ratio(count((r) => r.pred === "UNCERTAIN"), rows.length),
		tokenSavings: ratio(saved, total),
		confusion: confusion(rows),
	};
}

export function percentile(xs: number[], p: number): number {
	if (xs.length === 0) return Number.NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

/** Most frequent value; ties broken toward the safer decision (KEEP > TRUNCATE > UNCERTAIN > DROP). */
export function majority(preds: Prediction[]): Prediction {
	const order: Prediction[] = ["KEEP", "TRUNCATE", "UNCERTAIN", "DROP"];
	const counts = new Map<Prediction, number>();
	for (const p of preds) counts.set(p, (counts.get(p) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]![0];
}
