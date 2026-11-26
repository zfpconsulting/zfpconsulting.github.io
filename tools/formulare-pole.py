#!/usr/bin/env python3
"""Ze všech oficiálních PDF ve pipeline/formulare/ vytáhne vyplnitelná pole (text, zaškrtávátka, volby, rozbalovací seznamy)
a poskládá z nich vstupy pro levý panel záložky Formuláře → pipeline/formulare/pole.json.

Pro každý formulář: sekce (podle nadpisů v PDF) → položky v pořadí, jak jdou v PDF:
  {i: id, l: popisek, t: "text"|"date"|"check"|"choice"|"select"|"comb", n: [jména polí], o: [[popisek, exportní hodnota], …],
   ck: klíč údaje klienta (z mapování v index.json), ml: max. délka, r: [[strana, x, y, w, h], …] (body, y od horního okraje)}
Popisky: text vlevo / nad polem / vpravo od zaškrtávátka, jinak název pole. Ruční opravy: tools/formulare-pole-opravy.json
({"<id formuláře>": {"drop": [jména polí], "label": {jméno: popisek}, "sec": {jméno: sekce}, "dropsec": [sekce]}}).
Potřebuje: python3-pypdf, pdfplumber.  Spuštění: python3 tools/formulare-pole.py"""
import json, os, re, sys, unicodedata
import pypdf, pdfplumber

R = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DIR = os.path.join(R, "pipeline", "formulare")
FIX = os.path.join(R, "tools", "formulare-pole-opravy.json")

def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")); s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower().replace("_", " ")).strip()

GENERIC = re.compile(r"^(textove pole|text|fill|undefined|comb|pole|textfield|field|untitled|zaskrtavaci pole|check ?box|group|chk|cb|tf|txt|kontrola|policko|radio|button|tlacitko|choice|combo|dropdown|list|seznam|zaskrt|volba|t|f|p|c|n|s|x|r|z|a|b)\s?[\d_.\-]*[a-z]?\d*$|^[a-z]{0,3}\d+([._ \-]\d+)*[a-z]?$|^[\d\W_]+$")

def cleanlab(s):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    s = re.sub(r"\s*\b\d\)\s*", " ", s)                 # odkazy na poznámky „1)“
    s = re.sub(r"[*]+", "", s)
    s = re.sub(r"[.…_]{3,}", " ", s)                     # tečky na vyplnění
    s = re.sub(r"\s+", " ", s).strip(" :;,-–/")
    return s

def generic(n):
    n = norm(n)
    if not n: return True
    if GENERIC.match(n): return True
    first = re.split(r"[ ._\-]", n)[0]
    return bool(GENERIC.match(first)) and len(n.split()) <= 3 and not re.search(r"[a-z]{5,}", " ".join(n.split()[1:]))
def namelab(n):
    n = n.split(".")[-1]
    if generic(n): return ""
    n = re.sub(r"[_]+", " ", n)
    n = "".join((" " + c) if (c.isupper() and i and n[i - 1].islower()) else c for i, c in enumerate(n))
    n = re.sub(r"\s*\d+$", "", n).strip()
    return n if len(re.sub(r"[^A-Za-zÁ-žá-ž]", "", n)) >= 3 else ""

def letters(s): return len(re.sub(r"[^A-Za-zÁ-Žá-ž]", "", s or ""))

HEAD_RX = re.compile(r"^(([A-H]|[IVX]{1,4}|\d{1,2})[.)]?\s+)?[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9][A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9 ,/()\-–:„“\"]{3,}$")
NUMHEAD = re.compile(r"^(([A-H]|\d{1,2})[.)]?\s+|[A-H]\s)[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]")
OFFICE = re.compile(r"vyplni (pojistovna|penzijni|spolecnost|banka|pojistitel|instituce)|pro (vnitrni|interni) (potrebu|ucely)|interni zaznam|vyplnuje (pojistovna|spolecnost|ps\b)|nevyplnujte|pouze pro potreby|zaznam (pojistovny|spolecnosti)|potvrzeni o prijeti")

def page_text(pg):
    words = pg.extract_words(extra_attrs=["fontname", "size", "upright"], keep_blank_chars=False, use_text_flow=False, x_tolerance=2.2)
    W = [dict(x0=w["x0"], x1=w["x1"], t=w["top"], b=w["bottom"], s=w["text"],
              bold=bool(re.search(r"bold|black|heavy|semibold|demi", w["fontname"], re.I)), sz=w["size"]) for w in words if w.get("upright", True)]
    lines = []
    try:
        for l in pg.extract_text_lines(return_chars=True, strip=True):
            ch = [c for c in l["chars"] if c["text"].strip() and c.get("upright", True)]
            if not ch: continue
            # řádek rozdělit na úseky podle velkých mezer (dva sloupce)
            seg = [[ch[0]]]
            for c in ch[1:]:
                if c["x0"] - seg[-1][-1]["x1"] > 25: seg.append([c])
                else: seg[-1].append(c)
            for sg in seg:
                txt = "".join(c["text"] for c in sg)
                # obnov mezery
                out = sg[0]["text"]
                for a, b in zip(sg, sg[1:]):
                    out += (" " if b["x0"] - a["x1"] > max(0.9, a["size"] * 0.13) else "") + b["text"]
                bold = all(re.search(r"bold|black|heavy|semibold|demi", c["fontname"], re.I) for c in sg)
                lines.append(dict(x0=sg[0]["x0"], x1=sg[-1]["x1"], t=min(c["top"] for c in sg), b=max(c["bottom"] for c in sg),
                                  s=out.strip(), bold=bold, sz=max(c["size"] for c in sg)))
                tok = out.strip().split(" "); lead = []
                for tk in tok:
                    if any(c.islower() for c in tk): break
                    lead.append(tk)
                lead_s = " ".join(lead).strip(" ,:–-")
                m = lead_s if (0 < len(lead) < len(tok) and letters(lead_s) >= 7) else None
                if m:
                    lines.append(dict(x0=sg[0]["x0"], x1=sg[-1]["x1"], t=min(c["top"] for c in sg), b=max(c["bottom"] for c in sg),
                                      s=m, bold=True, sz=max(c["size"] for c in sg), lead=True))
    except Exception:
        pass
    return W, lines

def side_bands(pg):
    """svislé popisky sekcí u levého okraje (NN, Kooperativa: otočený text v barevném pruhu) → [(top, bottom, text)]"""
    ch = [c for c in pg.chars if not c.get("upright", True) and c["text"].strip() and c["x0"] < pg.width * 0.12]
    cols = {}
    for c in ch: cols.setdefault(round(c["x0"] / 3), []).append(c)
    runs = []
    for k, cs in sorted(cols.items()):
        cs.sort(key=lambda c: -c["top"])
        cur = [cs[0]]
        for c in cs[1:]:
            if cur[-1]["top"] - c["bottom"] > 6: runs.append((k, cur)); cur = [c]
            else: cur.append(c)
        runs.append((k, cur))
    labs = []
    for k, r in runs:
        t = r[0]["text"]
        for a, b in zip(r, r[1:]): t += (" " if a["top"] - b["bottom"] > a["size"] * 0.12 else "") + b["text"]
        labs.append(dict(x=k * 3, t=min(c["top"] for c in r), b=max(c["bottom"] for c in r), s=t.strip()))
    # dvouřádkové popisky (sousední sloupce, překryv)
    labs.sort(key=lambda l: (l["x"], l["t"])); out = []
    for l in labs:
        m = next((o for o in out if 0 < l["x"] - o["x"] <= 12 and not (l["b"] < o["t"] or l["t"] > o["b"])), None)
        if m: m["s"] += " " + l["s"]; m["t"] = min(m["t"], l["t"]); m["b"] = max(m["b"], l["b"])
        else: out.append(dict(l))
    bands = []
    for l in out:
        if letters(l["s"]) < 4: continue
        cy = (l["t"] + l["b"]) / 2
        rs = [r for r in list(pg.rects) + list(pg.curves) if r["width"] < 45 and r["x0"] <= l["x"] + 2 and r["x1"] >= l["x"] and r["top"] <= l["t"] + 1 and r["bottom"] >= l["b"] - 1 and r["height"] < pg.height * 0.8]
        if rs:
            r = min(rs, key=lambda r: r["height"]); bands.append((r["top"], r["bottom"], l["s"]))
        else: bands.append((l["t"] - 30, l["b"] + 30, l["s"]))
    return bands

def is_head(l, body, pw=600):
    s = l["s"].strip()
    if l["bold"] and l["x0"] < pw * 0.2 and s[:1].isupper() and 8 <= letters(s) and len(s) <= 90 and not s.endswith((".", ":")) and len(s.split()) >= 2 and not re.match(r"^(IBAN|BIC|SWIFT|DATUM|PODPIS|PSČ|Na účet|Upozornění|Poznámka)", s): return True
    if len(s) < 4 or len(s) > 90 or letters(s) < 4: return False
    if re.search(r"\b(strana|str\.)\s*\d|^\d+\s*/\s*\d+$|www\.|@|tel\.|ičo|ič:|sídlem|zapsan", s, re.I): return False
    up = sum(1 for c in s if c.isupper()); lo = sum(1 for c in s if c.islower())
    if NUMHEAD.match(s) and (l["bold"] or l["sz"] >= body + 1.5 or up >= lo): return True
    if l["bold"] and (up >= lo * 0.6 or l["sz"] >= body + 0.8) and not s.endswith(".") and not re.match(r"^(IBAN|BIC|SWIFT|DATUM|PODPIS|PSČ)\b", s) and (len(s.split()) >= 2 or letters(s) >= 8): return True
    if l["sz"] >= body + 2 and len(s) < 70: return True
    if up > 6 and lo == 0 and l["sz"] >= body - 0.1 and (len(s.split()) >= 2 or letters(s) >= 9) and not re.match(r"^(IBAN|BIC|SWIFT|DATUM|PODPIS|PSČ|IČO?)\b", s): return True
    return False

def run_left(W, x0, t, b, barrier, first=45):
    cy = (t + b) / 2
    cand = [w for w in W if w["x1"] <= x0 + 2 and w["x0"] >= barrier - 1 and w["t"] - 2 <= cy <= w["b"] + 2]
    cand.sort(key=lambda w: -w["x1"])
    run = []; prev = x0
    for w in cand:
        if prev - w["x1"] > (first if not run else 9): break
        run.insert(0, w); prev = w["x0"]
    return run

def extend_up(W, run, xmax):
    """popisek začínající malým písmenem je pokračování věty z řádku nad ním → přidat řádky nad (max. 3)"""
    if not run: return run
    out = list(run)
    for _ in range(3):
        if out[0]["s"][:1].isupper() or out[0]["s"][:1].isdigit(): break
        t0 = min(w["t"] for w in out); x0 = min(w["x0"] for w in out)
        up = [w for w in W if 1 <= t0 - w["b"] <= 9 and w["x0"] >= x0 - 40 and w["x1"] <= xmax + 1]
        if not up: break
        nb = max(w["b"] for w in up); line = sorted([w for w in up if nb - w["b"] < 2.5], key=lambda w: w["x0"])
        out = line + out
    return out

def run_right(W, x1, t, b, barrier):
    cy = (t + b) / 2
    cand = sorted([w for w in W if w["x0"] >= x1 - 2 and w["x1"] <= barrier + 1 and w["t"] - 3 <= cy <= w["b"] + 3], key=lambda w: w["x0"])
    run = []; prev = x1
    for w in cand:
        if w["x0"] - prev > (22 if not run else 9): break
        run.append(w); prev = w["x1"]
    # pokračování na dalším řádku (dlouhé texty u zaškrtávátek)
    if run and len(" ".join(w["s"] for w in run)) > 25:
        nx = sorted([w for w in W if 0 < w["t"] - run[0]["b"] < 6 and run[0]["x0"] - 3 <= w["x0"] <= barrier], key=lambda w: w["x0"])
        prev = None
        for w in nx:
            if prev and w["x0"] - prev > 9: break
            run.append(w); prev = w["x1"]
            if len(run) > 30: break
    return run

def run_above(W, x0, x1, t, barrier_r):
    cand = [w for w in W if w["t"] <= t + 3 and -4 <= t - w["b"] <= 13 and x0 - 8 <= w["x0"] < min(barrier_r, max(x1, x0 + 60))]
    if not cand: return []
    near = max(w["b"] for w in cand); line = sorted([w for w in cand if near - w["b"] < 2.5], key=lambda w: w["x0"])
    run = [line[0]]
    for w in line[1:]:
        if w["x0"] - run[-1]["x1"] > 10: break
        run.append(w)
    return run

def txt(run): return " ".join(w["s"] for w in run)

def widgets(path):
    r = pypdf.PdfReader(path); out = []
    for pi, pg in enumerate(r.pages):
        mb = [float(v) for v in pg.mediabox]; H = mb[3] - mb[1]
        for a in (pg.get("/Annots") or []):
            a = a.get_object()
            if a.get("/Subtype") != "/Widget": continue
            nm = []; o = a; ft = None; tu = None; ff = None; opt = None; ml = None
            while o is not None:
                if o.get("/T") is not None: nm.insert(0, str(o.get("/T")))
                if ft is None and o.get("/FT"): ft = str(o.get("/FT"))
                if tu is None and o.get("/TU"): tu = str(o.get("/TU"))
                if ff is None and o.get("/Ff") is not None: ff = int(o.get("/Ff"))
                if opt is None and o.get("/Opt") is not None: opt = o.get("/Opt")
                if ml is None and o.get("/MaxLen") is not None: ml = int(o.get("/MaxLen"))
                o = o.get("/Parent").get_object() if o.get("/Parent") else None
            if not nm or ft not in ("/Tx", "/Btn", "/Ch"): continue
            ff = ff or 0
            if ft == "/Btn" and ff & (1 << 16): continue          # tlačítko (push button)
            on = None
            if ft == "/Btn":
                try: on = [str(k)[1:] for k in a["/AP"]["/N"].keys() if str(k) != "/Off"]
                except Exception: on = []
                if not on: continue
            opts = None
            if ft == "/Ch" and opt is not None:
                opts = []
                for x in opt:
                    x = x.get_object() if hasattr(x, "get_object") else x
                    if isinstance(x, (list, pypdf.generic.ArrayObject)): opts.append([str(x[1]), str(x[0])])
                    else: opts.append([str(x), str(x)])
            rc = [float(v) for v in a.get("/Rect")]
            x0, x1 = min(rc[0], rc[2]) - mb[0], max(rc[0], rc[2]) - mb[0]
            yb, yt = min(rc[1], rc[3]) - mb[1], max(rc[1], rc[3]) - mb[1]
            if x1 - x0 < 2 or yt - yb < 2: continue
            out.append(dict(p=pi, x0=x0, x1=x1, t=H - yt, b=H - yb, n=".".join(nm), ft=ft, ff=ff, on=on, opts=opts, ml=ml,
                            tu=tu if tu not in (None, "None", "undefined") else "", hid=bool(int(a.get("/F", 0)) & 2), ro=bool(ff & 1)))
    return r, out

def build(form, fix):
    path = os.path.join(DIR, form["file"])
    reader, WD = widgets(path)
    if not WD: return None
    fill = form.get("fill") or {}
    drop = set(fix.get("drop", [])); lab_fix = fix.get("label", {}); sec_fix = fix.get("sec", {}); dropsec = [norm(s) for s in fix.get("dropsec", [])]
    texts = {}
    with pdfplumber.open(path) as pdf:
        for pi, pg in enumerate(pdf.pages):
            W, L = page_text(pg)
            sizes = sorted(w["sz"] for w in W); body = sizes[len(sizes) // 2] if sizes else 8
            heads = [l for l in L if is_head(l, body, pg.width)]
            try: bands = side_bands(pg)
            except Exception: bands = []
            texts[pi] = (W, heads, pg.height, bands)
    # slova vpravo od zaškrtávátek patří jim
    owned = {}
    for w in WD:
        if w["ft"] != "/Btn": continue
        W = texts.get(w["p"], ([], [], 0, []))[0]
        row = [o for o in WD if o is not w and o["p"] == w["p"] and not (o["b"] < w["t"] + 2 or o["t"] > w["b"] - 2)]
        br = min([o["x0"] for o in row if o["x0"] >= w["x1"] - 1] + [9999])
        for x in run_right(W, w["x1"], w["t"], w["b"], br)[:8]: owned[id(x)] = 1
    # popisky ke každému widgetu
    for w in WD:
        W, heads, _, bands = texts.get(w["p"], ([], [], 0, []))
        row = [o for o in WD if o is not w and o["p"] == w["p"] and not (o["b"] < w["t"] + 2 or o["t"] > w["b"] - 2)]
        bl = max([o["x1"] for o in row if o["x1"] <= w["x0"] + 1] + [-1])
        br = min([o["x0"] for o in row if o["x0"] >= w["x1"] - 1] + [9999])
        Wf = [x for x in W if id(x) not in owned] if w["ft"] != "/Btn" else W
        left = cleanlab(txt(extend_up(Wf, run_left(Wf, w["x0"], w["t"], w["b"], bl), w["x0"])))
        above = cleanlab(txt(run_above(Wf, w["x0"], w["x1"], w["t"], br)))
        right = cleanlab(txt(run_right(W, w["x1"], w["t"], w["b"], br))) if w["ft"] == "/Btn" else ""
        inside = cleanlab(txt([x for x in W if x["x0"] >= w["x0"] - 1 and x["x1"] <= w["x1"] + 1 and x["t"] >= w["t"] - 1 and x["b"] <= w["b"] + 1]))
        nl = namelab(w["n"]); tl = cleanlab(w["tu"]) if not generic(w["tu"]) else ""
        lw = run_left(Wf, w["x0"], w["t"], w["b"], bl); gapL = (w["x0"] - lw[-1]["x1"]) if lw else 999
        if w["ft"] == "/Btn":
            lab = right if letters(right) >= 2 else (left if letters(left) >= 2 else (tl or nl or (above if letters(above) >= 2 else "")))
            w["short"] = letters(right) >= 1 and letters(right) <= 4 and letters(left) >= 4 and norm(left) != norm(right)
        else:
            if letters(left) >= 2 and gapL <= 28: lab = left
            elif letters(above) >= 2: lab = above
            elif letters(left) >= 2: lab = left
            elif letters(inside) >= 2: lab = inside
            else: lab = tl or nl
            if letters(lab) < 2: lab = tl or nl
            if letters(lab) < 2: lab = cleanlab(txt(run_left(Wf, w["x0"], w["t"], w["b"], bl, 120)))
            if letters(lab) < 2:   # popisek pod čarou / vpravo
                bel = sorted([x for x in Wf if 0 <= x["t"] - w["b"] <= 9 and w["x0"] - 10 <= x["x0"] < w["x1"]], key=lambda x: x["x0"])
                lab = cleanlab(txt(bel[:8])) or cleanlab(txt(run_right(Wf, w["x1"], w["t"], w["b"], br)))
            # věta z okolí, která s názvem pole nemá nic společného → název pole
            if (nl or tl) and lab and (lab[0].islower() or len(lab.split()) > 7):
                nw = {x[:5] for x in norm(nl or tl).split() if len(x) > 2}; lw2 = {x[:5] for x in norm(lab).split() if len(x) > 2}
                if not (nw & lw2): lab = nl or tl
        w["lab"] = lab; w["left"] = left; w["above"] = above; w["right"] = right; w["nl"] = nl or tl
        # sekce = nejbližší nadpis nad polem (ve stejném sloupci)
        sec = None
        for h in heads:
            if h["t"] <= w["t"] + 3 and h["x0"] <= w["x0"] + 12:
                if sec is None or (h["t"], h["x0"]) > (sec["t"], sec["x0"]): sec = h
        cy = (w["t"] + w["b"]) / 2
        band = next((bd for bd in bands if bd[0] - 2 <= cy <= bd[1] + 2), None)
        if band and not (sec and sec["t"] >= band[0] - 2): w["sec"] = cleanlab(band[2])
        else: w["sec"] = cleanlab(sec["s"]) if sec else None
    # pořadí: strana, řádek, x
    WD.sort(key=lambda w: (w["p"], round(w["t"] / 4), w["x0"]))
    # sekce přenést přes strany
    last = None
    for w in WD:
        if w["n"] in sec_fix: w["sec"] = sec_fix[w["n"]]
        if w["sec"] is None: w["sec"] = last
        last = w["sec"]
    # hřebínky z jednotlivých políček (každé políčko = jiné pole)
    used = set(); combs = {}
    tx = [w for w in WD if w["ft"] == "/Tx" and (w["x1"] - w["x0"]) <= 22]
    for w in tx:
        if id(w) in used: continue
        run = [w]
        while True:
            nx = [o for o in tx if id(o) not in used and o is not run[-1] and o not in run and o["p"] == w["p"] and abs(o["t"] - run[-1]["t"]) < 3 and 0 <= o["x0"] - run[-1]["x1"] < 9]
            if not nx: break
            run.append(min(nx, key=lambda o: o["x0"]))
        if len(run) >= 3 and len({o["n"] for o in run}) == len(run):
            for o in run: used.add(id(o))
            combs[id(run[0])] = run
    # položky
    items = []; seen = {}
    for w in WD:
        if w["n"] in drop or w["ro"]: continue
        if norm(w["n"]).startswith("barcode") or norm(w["n"]) in ("tisk", "print", "reset", "vymazat", "odeslat"): continue
        if id(w) in used and id(w) not in combs: continue
        key = w["n"]
        if w["ft"] == "/Tx" and id(w) in combs:
            run = combs[id(w)]
            it = dict(t="comb", n=[o["n"] for o in run], l=w["lab"], r=[[o["p"], o["x0"], o["t"], o["x1"] - o["x0"], o["b"] - o["t"]] for o in run], sec=w["sec"], w=w)
            items.append(it); continue
        if key in seen:
            it = seen[key]; it["r"].append([w["p"], w["x0"], w["t"], w["x1"] - w["x0"], w["b"] - w["t"]])
            if w["ft"] == "/Btn":
                for v in w["on"]:
                    if v not in [o[1] for o in it["o"]]: it["o"].append([w["lab"], v]); it["ow"].append(w)
            continue
        if w["ft"] == "/Tx": it = dict(t="text", n=[key], l=w["lab"], ml=w["ml"])
        elif w["ft"] == "/Ch": it = dict(t="select", n=[key], l=w["lab"] or w["nl"], o=w["opts"] or [], edit=bool(w["ff"] & (1 << 18)))
        else: it = dict(t="check", n=[key], l=w["lab"], o=[[w["lab"], v] for v in w["on"]], ow=[w])
        it.update(r=[[w["p"], w["x0"], w["t"], w["x1"] - w["x0"], w["b"] - w["t"]]], sec=w["sec"], w=w)
        seen[key] = it; items.append(it)
    out = []
    for it in items:
        w = it.pop("w"); ow = it.pop("ow", None)
        if it["t"] == "check" and len(it["o"]) > 1:
            it["t"] = "choice"
            # popisek volby: text vlevo od první možnosti, která není sama popiskem jiné možnosti; jinak nadpis řádku / název pole
            optl = {norm(o[0]) for o in it["o"]}
            first = min(ow, key=lambda o: (o["p"], o["t"], o["x0"]))
            cand = [first["left"], first["above"], first["nl"]]
            gl = next((c for c in cand if letters(c) >= 2 and norm(c) not in optl and not any(norm(c).endswith(x) for x in optl if x)), "")
            if not gl or len(gl) < 3:
                gl = next((c for c in cand if letters(c) >= 2 and norm(c) not in optl), gl)
            it["l"] = gl or w["nl"] or "Volba"
            # stejné popisky možností → doplnit pořadí
            labs = [o[0] for o in it["o"]]
            for i, o in enumerate(it["o"]):
                if not o[0] or labs.count(o[0]) > 1: o[0] = (o[0] + " " if o[0] else "Možnost ") + str(i + 1)
        if it["t"] == "check":
            it["v"] = it.pop("o")[0][1]
            if w.get("short"): it["l"] = w["left"] + ": " + w["right"]
        if it["t"] == "choice" and (it["l"] in ("Volba",) or letters(it["l"]) < 3 or it["l"][:1].islower()):
            ol = " ".join(norm(o[0]) for o in it["o"])
            for rx, nm in ((r"\b(op|pas|ridicsk|rp)\b", "Doklad totožnosti"), (r"\b(muz|zena)\b", "Pohlaví"), (r"mesicne|ctvrtletne|rocne|pololetne", "Frekvence"),
                           (r"zmocnen|opatrovn|zakonny zastup|porucn|plna moc", "Kdo jedná za klienta"), (r"^ano\b.*\bne\b", "Ano / ne")):
                if re.search(rx, ol): it["l"] = nm if (it["l"] in ("Volba",) or letters(it["l"]) < 3) else it["l"]; break
        UNIT = {"kc": "Kč", "%": "%", "let": "let", "mesicu": "měsíců", "czk": "Kč"}
        if it["t"] in ("text", "comb") and norm(it["l"]) in UNIT:
            alt = next((c for c in (w["above"], w["nl"]) if letters(c) >= 3 and norm(c) not in UNIT), "")
            it["l"] = (alt + " (" + UNIT[norm(it["l"])] + ")") if alt else "Částka (" + UNIT[norm(it["l"])] + ")"
        if norm(w["n"].split(".")[-1]) == "v" or it["l"] in ("V", "V:"): it["l"] = "Místo podpisu (V …)"
        if re.match(r"^č\.?\s?p\.?$", it["l"].lower()): it["l"] = "Číslo popisné"
        if re.match(r"^č\.?\s?o\.?$", it["l"].lower()): it["l"] = "Číslo orientační"
        n0 = it["n"][0]
        if n0 in lab_fix: it["l"] = lab_fix[n0]
        LL = norm(it["l"])
        if it["t"] == "text" and (re.search(r"^(datum|dne|ke dni|k datu|od data|platn[a-z]* do|vydan[a-z]* dne|ucinnost)", LL) or re.search(r"\b(dne|platn[a-z]* do|datum)$", LL)) and not re.search(r"misto|jmeno|prijmeni|rodne", LL):
            it["t"] = "date"
        ck = None
        for n in it["n"]:
            if n in fill: ck = fill[n]; break
        if ck: it["ck"] = ck
        if letters(it["l"]) < 2: it["l"] = w["nl"] or "Pole"
        if len(it["l"]) > 110: it["l"] = it["l"][:107].rsplit(" ", 1)[0] + "…"
        it["r"] = [[a, round(b, 1), round(c, 1), round(d, 1), round(e, 1)] for a, b, c, d, e in it["r"]]
        if it.get("ml") is None: it.pop("ml", None)
        out.append(it)
    # údaje klienta, které mapování v index.json nepokrylo: první výskyt klíče v PDF (první osoba na formuláři)
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from formulare import classify
    except Exception:
        classify = None
    if classify:
        have = {str(it.get("ck", "")).split("@")[0] for it in out}
        person = {"surname", "firstname", "fullname", "fullnameRev", "title", "rc", "rcbirth", "birth", "street", "streetcp", "cp", "city", "psc", "phone", "email"}
        grp = {"fullname": {"surname", "firstname", "fullname", "fullnameRev"}, "fullnameRev": {"surname", "firstname", "fullname", "fullnameRev"},
               "surname": {"fullname", "fullnameRev", "surname"}, "firstname": {"fullname", "fullnameRev", "firstname"}, "rcbirth": {"rc", "rcbirth"}, "rc": {"rc", "rcbirth"},
               "streetcp": {"street", "streetcp"}, "street": {"street", "streetcp"}}
        bad = re.compile(r"zastup|zakonn|opatrov|zmocn|poradc|zprostred|ziskatel|opravnen|urcen|dedic|pojisteny 2|druh|novy|nova|nove|stavajic|puvodn|zamestnav|spolecnost|banky|majitel|identifik|prodejce|spolupracovn|jine osoby|vztah")
        # staré mapování z index.json, které popisku pole zjevně odporuje (např. jméno do „Telefon jiné osoby“) → pryč
        for it in out:
            ck = str(it.get("ck", "")).split("@")[0]
            if ck not in person: continue
            L = norm(it["l"]); k = classify(L)
            if bad.search(L) or (k in person and not (grp.get(k, {k}) & grp.get(ck, {ck})) and not (k in ("rc", "rcbirth", "birth") and ck in ("rc", "rcbirth", "birth"))):
                it.pop("ck", None)
        have = {str(it.get("ck", "")).split("@")[0] for it in out}
        first_person_sec = None
        for it in out:
            if it.get("ck") or it["t"] not in ("text", "comb"): continue
            L = norm(it["l"])
            if bad.search(L) or bad.search(norm(it.get("sec") or "")): continue
            k = classify(L)
            if k not in person: continue
            if have & grp.get(k, {k}): continue
            sec = it.get("sec")
            if first_person_sec is None: first_person_sec = sec
            elif sec != first_person_sec: continue
            it["ck"] = k; have.add(k)
    # nadpisy, které jsou ve skutečnosti popiskem některého pole (tučný popisek řádku), nejsou sekcí
    labs = [norm(it["l"]) for it in out]
    last = None
    for it in out:
        sc = it.get("sec")
        if sc and any(norm(sc) and (L.startswith(norm(sc)) or norm(sc).startswith(L)) and len(L) > 3 for L in labs): it["sec"] = last
        else: last = sc
    # sekce
    secs = []
    for it in out:
        s = it.pop("sec") or "Formulář"
        if any(norm(s).startswith(d) for d in dropsec) or OFFICE.search(norm(s)): continue
        if not secs or secs[-1]["s"] != s: secs.append(dict(s=s, q=[]))
        secs[-1]["q"].append(it)
    # A, B, A s malým B → jedna sekce A
    i = 1
    while i < len(secs) - 1:
        if secs[i - 1]["s"] == secs[i + 1]["s"] and len(secs[i]["q"]) <= 3:
            secs[i - 1]["q"] += secs[i]["q"] + secs[i + 1]["q"]; del secs[i:i + 2]
        else: i += 1
    for i, s in enumerate(secs):
        for j, it in enumerate(s["q"]): it["i"] = "q%d_%d" % (i, j)
    pages = [[round(float(p.mediabox.width), 1), round(float(p.mediabox.height), 1)] for p in reader.pages]
    return dict(pg=pages, s=secs)

def main():
    idx = json.load(open(os.path.join(DIR, "index.json"), encoding="utf-8"))
    fixes = json.load(open(FIX, encoding="utf-8")) if os.path.exists(FIX) else {}
    out = {}; n = 0
    for f in idx["forms"]:
        if not f["file"].endswith(".pdf"): continue
        try:
            s = build(f, fixes.get(f["id"], {}))
        except Exception as e:
            print("CHYBA", f["id"], e, file=sys.stderr); continue
        if s: out[f["id"]] = s; n += sum(len(x["q"]) for x in s["s"])
    json.dump(out, open(os.path.join(DIR, "pole.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("formulářů", len(out), "položek", n, "→ pipeline/formulare/pole.json", round(os.path.getsize(os.path.join(DIR, "pole.json")) / 1024), "kB")

if __name__ == "__main__":
    main()
