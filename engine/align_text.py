"""Words to letters (align.py's first job): the model's alphabet, how a transcript word is read as classes (apostrophes, punctuation, accents, numbers said in
words, symbols as wildcards), and which words are fillers. Plain functions; no model, tested by test_align.py."""
import re
import unicodedata

BLANK = 0
WILD = -1                      # spoken but not spellable: matches any letter's sound

FILLER = re.compile(r"^(u+[hm]+|u+m+h*|e+r+m*|e+h+|a+h+|a+h+m+|h+m+|m+h*m+|m+m+|uh+-?h*u*h*|mm+-?hm+)$")


def is_filler(word):
    """True for um / uh / er / ah / hmm (any case, any punctuation around, stretched letters)."""
    w = re.sub(r"[^a-z-]", "", word.lower()).strip("-")
    return bool(w) and bool(FILLER.match(w))


# ---------- text to letters ----------

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
        "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
SCALES = [(10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")]
ORDINAL = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth", "twelve": "twelfth"}


def cardinal(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + (" " + ONES[n % 10] if n % 10 else "")
    if n < 1000:
        return ONES[n // 100] + " hundred" + (" " + cardinal(n % 100) if n % 100 else "")
    for size, name in SCALES:
        if n >= size:
            return cardinal(n // size) + " " + name + (" " + cardinal(n % size) if n % size else "")
    return ""


def in_pairs(n, split):
    """1999 as "nineteen ninety nine", 429 as "four twenty nine"."""
    head, tail = divmod(n, split)
    return cardinal(head) + " " + ("hundred" if tail == 0 else "oh " + ONES[tail] if tail < 10 else cardinal(tail))


def _last_word(words, change):
    parts = words.split(" ")
    parts[-1] = change(parts[-1])
    return " ".join(parts)


NUMBER = re.compile(r"^([$€£]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|st|nd|rd|th|s|k|m|bn?)?$", re.I)


def spoken_number(text):
    """How a number written in digits may be said, most likely first ("$7.63" = "seven sixty three", "seven dollars and sixty three cents", ...). None if it is not a number."""
    t = text.strip()
    a, b = 0, len(t)
    while a < b and not (t[a].isalnum() or t[a] in "$€£"):
        a += 1
    while b > a and not (t[b - 1].isalnum() or t[b - 1] == "%"):
        b -= 1
    m = NUMBER.match(t[a:b])
    if not m:
        return None
    currency, whole, fraction, suffix = m.group(1), m.group(2), m.group(3), (m.group(4) or "").lower()
    digits = whole.replace(",", "")
    if len(digits) > 12:
        return None
    n = int(digits)

    def one(d):
        return " ".join(ONES[int(c)] for c in d)

    forms = [one(digits)] if len(digits) > 1 and digits.startswith("0") else [cardinal(n)]
    if not fraction and not currency and len(digits) == 4 and 1100 <= n < 2100 and n % 1000 >= 10:
        forms.insert(0, in_pairs(n, 100))
    elif not fraction and len(digits) == 3 and not digits.startswith("0") and n % 100:
        forms.append(in_pairs(n, 100))
    if suffix == "k":
        forms = [x for f in forms for x in (f + " k", f + " thousand")]
    elif suffix == "m":
        forms = [f + " million" for f in forms]
    elif suffix in ("b", "bn"):
        forms = [f + " billion" for f in forms]
    elif suffix in ("st", "nd", "rd", "th"):
        forms = [_last_word(f, lambda w: ORDINAL.get(w) or (w[:-1] + "ieth" if w.endswith("y") else w + "th")) for f in forms]
    elif suffix == "s":
        forms = [_last_word(f, lambda w: w[:-1] + "ies" if w.endswith("y") else w + "s") for f in forms]
    money, cents = {"$": ("dollars", "cents"), "€": ("euros", "cents"), "£": ("pounds", "pence")}.get(currency, (None, None))
    units = money[:-1] if money and n == 1 else money
    if fraction and money and len(fraction) == 2:
        c = int(fraction)
        small = "oh " + ONES[c] if c < 10 else cardinal(c)
        forms = [x for f in forms for x in (f"{f} {small}", f"{f} {units} and {cardinal(c)} {cents}", f"{f} {units} {cardinal(c)}", f"{f} point {one(fraction)}")]
    else:
        if fraction:
            forms = [f"{f} point {one(fraction)}" for f in forms]
        if money:
            forms = [x for f in forms for x in (f"{f} {units}", f)]
    if suffix == "%":
        forms = [f + " percent" for f in forms]
    seen = []
    for f in forms:
        if f not in seen:
            seen.append(f)
    return seen[:4]


def alpha_from_labels(labels):
    """The model's alphabet: {"n", "sep", "letters": {char: class}, "apos"}. Works for MMS_FA (a-z ' and a * wildcard class, no word separator)
    and wav2vec2-base-960h (A-Z ' and "|" between words)."""
    letters, sep = {}, None
    for i, lab in enumerate(labels):
        if i == BLANK:
            continue
        if lab == "|":
            sep = i
        elif len(lab) == 1 and (lab.isalpha() or lab == "'"):
            letters[lab.lower()] = i
    return {"n": len(labels), "sep": sep, "letters": letters}


def _spell(words, alpha):
    out = []
    for ch in words.lower():
        if ch in alpha["letters"] and ch != "'":
            out.append(alpha["letters"][ch])
        elif ch == " " and out and out[-1] != alpha["sep"] and alpha["sep"] is not None:
            out.append(alpha["sep"])
    while out and out[-1] == alpha["sep"]:
        out.pop()
    return out or None


def word_readings(text, alpha):
    """The class numbers a transcript word is read as, one list for each way it may be said, most likely first.
    None = not speech (punctuation, [Music]); [[WILD]] = spoken but cannot be spelled (symbols, other scripts): it matches any sound and keeps its time."""
    raw = text.strip()
    if not raw or re.match(r"^[\[(*♪].*[\])*♪]$", raw):
        return None
    whole = spoken_number(raw)
    if whole:
        got = [_spell(f, alpha) for f in whole]
        got = [g for g in got if g]
        if got:
            return got
    s = unicodedata.normalize("NFKD", raw)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub("[‘’ʼ`´]", "'", s).lower()
    L, sep, out = alpha["letters"], alpha["sep"], []

    def letter(c):
        return bool(c) and c != "'" and c in L

    i = 0
    while i < len(s):
        ch = s[i]
        before = s[i - 1] if i else ""
        after = s[i + 1] if i + 1 < len(s) else ""
        if letter(ch):
            out.append(L[ch])
        elif ch == "'":
            if letter(before) and letter(after) and "'" in L:
                out.append(L["'"])
        elif ch in "-–—/":
            if out and letter(after) and sep is not None and out[-1] != sep:
                out.append(sep)
        elif ch.isdigit():
            run = re.match(r"\d+(?:[.,]\d+)*", s[i:]).group(0)
            if out and sep is not None and out[-1] != sep:
                out.append(sep)
            spoken = spoken_number(run)
            spelled = _spell(spoken[0] if spoken else one_by_one(run), alpha)
            out.extend(spelled or [])
            i += len(run) - 1
            if letter(s[i + 1] if i + 1 < len(s) else "") and sep is not None:
                out.append(sep)
        elif ch.isalnum() or ch in "$%&@+#=€£":
            return [[WILD]]
        i += 1
    while out and out[-1] == sep:
        out.pop()
    return [out] if out else None


def one_by_one(digits):
    return " ".join(ONES[int(c)] for c in digits if c.isdigit())


def group_tokens(words, alpha, reading=()):
    """Tokens of a run of words (a separator after each, when the alphabet has one) and the word each token belongs to (-1 = separator).
    Also: how many words are spoken and how many of those are spellable."""
    tokens, owner, spoken, spelled = [], [], 0, 0
    for i, w in enumerate(words):
        r = word_readings(w, alpha)
        if not r:
            continue
        labels = r[min(reading[i] if i < len(reading) else 0, len(r) - 1)]
        spoken += 1
        if labels[0] != WILD:
            spelled += 1
        for t in labels:
            tokens.append(t)
            owner.append(i)
        if alpha["sep"] is not None:
            tokens.append(alpha["sep"])
            owner.append(-1)
    return tokens, owner, spoken, spelled
