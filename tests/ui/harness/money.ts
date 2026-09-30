/**
 * Money extraction from rendered text.
 *
 * DELIBERATELY independent of `app/lib/utils/currency.ts`: expected values in a
 * spec are plain numbers, and the amount read off the screen is parsed here.
 * If the parser called the app's formatter, a formatting bug would cancel
 * itself out.
 *
 * Handles: `$1,234.56`, `-$50`, `+$1,200.00`, `−$5` (unicode minus), `₱`, `€`,
 * `£`, `¥`, `₹`, `A$`, `C$`, `US$` (Intl's en-PH rendering of USD), `$ 5`, `(1,234)` accounting negatives, compact
 * `$1.2K` / `$3M`, and the European `€1.234,56` layout (de-DE, the app's EUR
 * locale) — pass `{ currency: "EUR" }` or `{ decimal: "," }` for that one.
 */
import { screen, within } from "@testing-library/dom";

export interface ParseOptions {
  /** Decimal separator. Default "." ("," for EUR when `currency: "EUR"`). */
  decimal?: "." | ",";
  currency?: string;
}

/** A currency symbol, optionally with a 1-3 letter locale prefix (`US$`, `A$`, `JP¥`). */
const SYMBOL = String.raw`(?:[A-Z]{1,3})?(?:\$|₱|€|£|¥|₹)`;
const SIGN = String.raw`[-+−–]`;
/** One money token: optional sign, symbol, optional sign, digits with separators, optional compact suffix. */
const TOKEN_SOURCE = String.raw`(?:\(\s*)?(${SIGN})?\s*${SYMBOL}\s*(${SIGN})?\s*(\d[\d.,]*\d|\d)(?:([KMB])(?![A-Za-z]))?\)?`;

const stripToNumber = (raw: string, decimal: "." | ","): number => {
  const cleaned = raw.replace(/\s/g, "");
  const thousands = decimal === "." ? "," : ".";
  const normalised = cleaned.split(thousands).join("").replace(decimal, ".");
  return Number(normalised);
};

const toValue = (match: RegExpExecArray, opts: ParseOptions): number => {
  const decimal = opts.decimal ?? (opts.currency === "EUR" ? "," : ".");
  let value = stripToNumber(match[3], decimal);
  const suffix = match[4];
  if (suffix === "K") value *= 1e3;
  if (suffix === "M") value *= 1e6;
  if (suffix === "B") value *= 1e9;
  const isMinus = (c?: string) => c === "-" || c === "−" || c === "–";
  const explicitPlus = match[1] === "+" || match[2] === "+";
  const accounting = /^\(/.test(match[0]) && !explicitPlus; // "(1,234)" is negative; "(+$5)" is not
  return isMinus(match[1]) || isMinus(match[2]) || accounting ? -value : value;
};

/**
 * Parse a single money string. Returns the FIRST token's value, or `null` if
 * the text contains no currency-symbol amount. Symbol-less numbers ("1,234.5")
 * are accepted only when the whole (trimmed) string is a number.
 */
export function parseMoney(text: string, opts: ParseOptions = {}): number | null {
  const all = moneyValues(text, opts);
  if (all.length > 0) return all[0];
  const bare = /^\s*([-+−–])?\s*(\d[\d.,]*)\s*$/.exec(text);
  if (bare) {
    const decimal = opts.decimal ?? (opts.currency === "EUR" ? "," : ".");
    const value = stripToNumber(bare[2], decimal);
    return bare[1] === "-" || bare[1] === "−" || bare[1] === "–" ? -value : value;
  }
  return null;
}

/** Every money token in `text`, in reading order. */
export function moneyValues(text: string, opts: ParseOptions = {}): number[] {
  const re = new RegExp(TOKEN_SOURCE, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(toValue(m, opts));
  return out;
}

/**
 * Text of an element with a space between adjacent text nodes, so
 * "Balance" + "$10,000" in sibling spans reads "Balance $10,000" rather than
 * fusing into "Balance$10,000".
 */
export function spacedText(el: Element): string {
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? "";
    if (t.trim()) parts.push(t.trim());
  }
  return parts.join(" ");
}

export interface NearOptions extends ParseOptions {
  /** Search inside this element (default: document.body). */
  within?: HTMLElement;
  /** Which amount after the label: 0 = first (default), 1 = second… */
  index?: number;
  /** How many ancestors to climb looking for an amount. Default 4. */
  maxDepth?: number;
  /**
   * When the label text appears several times (e.g. "Budgeted" once per card),
   * use only the Nth (0-based, document order). Default: try each in order and
   * return the first that has an amount near it.
   */
  occurrence?: number;
}

const matchesLabel = (text: string, label: string | RegExp): boolean =>
  typeof label === "string" ? text.trim() === label : label.test(text);

/**
 * The displayed money amount that follows `label` — find the element whose own
 * text is the label, then climb until an ancestor holds an amount AFTER the
 * label text (reading order), and return that amount as a number.
 *
 *   moneyNear("Current Balance")              // 10000
 *   moneyNear(/total expenses/i, { index: 0 }) // -1200 (sign preserved from the text)
 *
 * Throws with a descriptive message when the label or an amount is not found,
 * so a missing element can never be mistaken for a zero.
 */
export function moneyNear(label: string | RegExp, opts: NearOptions = {}): number {
  const root = opts.within ?? document.body;
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) => {
    // Own-text match only, so wrappers don't shadow the real label element.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("");
    return own.trim() !== "" && matchesLabel(own, label);
  });
  if (candidates.length === 0) {
    throw new Error(`moneyNear: no element with text ${String(label)}`);
  }
  if (opts.occurrence !== undefined && opts.occurrence >= candidates.length) {
    throw new Error(
      `moneyNear: wanted occurrence ${opts.occurrence} of ${String(label)} but only ${candidates.length} found`
    );
  }
  const maxDepth = opts.maxDepth ?? 4;
  const index = opts.index ?? 0;
  const searched = opts.occurrence === undefined ? candidates : [candidates[opts.occurrence]];
  for (const labelEl of searched) {
    const labelText = spacedText(labelEl);
    let scope: HTMLElement | null = labelEl;
    for (let depth = 0; scope && depth <= maxDepth; depth += 1, scope = scope.parentElement) {
      const text = spacedText(scope);
      const from = text.indexOf(labelText);
      const values = moneyValues(from >= 0 ? text.slice(from + labelText.length) : text, opts);
      if (values.length > index) return values[index];
      if (scope === root) break;
    }
  }
  throw new Error(`moneyNear: found label ${String(label)} but no money amount near it`);
}

/** All money amounts inside one element, in reading order. */
export function moneyIn(el: Element, opts: ParseOptions = {}): number[] {
  return moneyValues(spacedText(el), opts);
}

/**
 * Money amounts in the row/card that contains `rowText` (e.g. an income
 * source's name). `closest` picks the ancestor: the first ancestor holding at
 * least one money amount unless a selector is given.
 */
export function moneyInRow(
  rowText: string | RegExp,
  opts: ParseOptions & { within?: HTMLElement; closest?: string } = {}
): number[] {
  const scope = opts.within ? within(opts.within) : screen;
  const el = scope.getByText(rowText);
  let cursor: HTMLElement | null = el;
  while (cursor) {
    if (opts.closest ? cursor.matches(opts.closest) : moneyIn(cursor, opts).length > 0) {
      return moneyIn(cursor, opts);
    }
    cursor = cursor.parentElement;
  }
  throw new Error(`moneyInRow: no amount found in the row containing ${String(rowText)}`);
}
