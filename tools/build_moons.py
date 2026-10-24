"""
Builds src/data/moons.json from:
  - JPL SSD planetary satellite mean elements  https://ssd.jpl.nasa.gov/sats/elem/
  - JPL SSD planetary satellite physical params https://ssd.jpl.nasa.gov/sats/phys_par/
  - Wikipedia "List of natural satellites" (mean radius fallback for small moons)

Usage:
  python -I tools/build_moons.py <elem.html> <phys.html> <wiki.html> <out.json>
"""
import html as htmllib
import json
import re
import sys

TAG = re.compile(r"<[^>]+>")
PARENTS = ("Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto")


def clean(cell):
    return htmllib.unescape(TAG.sub(" ", cell)).replace("\xa0", " ").strip()


def num(s):
    s = s.replace(",", "").replace("−", "-").strip()
    m = re.search(r"[-+]?\d*\.?\d+(e[-+]?\d+)?", s, re.I)
    return float(m.group(0)) if m else None


def key(name):
    """Normalise 'S/2004 S 12', 'S2004_S_12' and 'Megaclite' alike."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def rows(table_html):
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.S):
        # JPL phys page omits </td>, so split on the opening tag instead
        parts = re.split(r"<t[dh][^>]*>", tr)[1:]
        yield [clean(re.sub(r"</t[dh]>", "", p)) for p in parts]


def parse_elem(path):
    src = open(path, encoding="utf-8").read()
    table = re.search(r'<table id="sat_elem".*?</table>', src, re.S).group(0)
    tbody = table[table.index("<tbody") :]
    out = []
    for c in rows(tbody):
        if len(c) < 19:
            continue
        frame = c[5].lower()
        out.append(
            {
                "planet": c[1],
                "name": c[2].replace("_", " "),
                "code": int(c[3]),
                "frame": "ecliptic" if "eclip" in frame else ("laplace" if "laplace" in frame else "equatorial"),
                "epoch": c[6],
                "a": num(c[7]),
                "e": num(c[8]),
                "w": num(c[9]),
                "M": num(c[10]),
                "i": num(c[11]),
                "node": num(c[12]),
                "P": num(c[13]),
                "Pw": num(c[14]),
                "Pnode": num(c[15]),
                "ra": num(c[16]) if c[16] else None,
                "dec": num(c[17]) if c[17] else None,
            }
        )
    return out


def parse_phys(path):
    src = open(path, encoding="utf-8").read()
    table = re.search(r'<table id="sat_phys_par".*?</table>', src, re.S).group(0)
    tbody = table[table.index("<tbody") :]
    out = {}
    for c in rows(tbody):
        if len(c) < 9:
            continue
        r = num(c[6])
        if r:
            out[int(c[2])] = {"radius": r, "gm": num(c[3])}
    return out


def parse_wiki(path):
    """Columns: name | image | parent | numeral | orbital speed | mean radius | ..."""
    src = open(path, encoding="utf-8").read()
    out = {}
    for table in re.findall(r"<table.*?</table>", src, re.S):
        for c in rows(table):
            if len(c) < 6 or c[2] not in PARENTS:
                continue
            name = re.sub(r"\[.*?\]", "", c[0]).strip()
            r = num(c[5])
            if r:
                out[key(name)] = (r, name)
    return out


ALIASES = {"magaclite": "megaclite"}


def lookup_wiki(wiki, name):
    """-> (radius, full name) ; JPL truncates long names ("Philophrosyn") and has a few typos."""
    k = key(name)
    k = ALIASES.get(k, k)
    if k in wiki:
        return wiki[k]
    if len(k) >= 8:
        for wk, v in wiki.items():
            if wk.startswith(k):
                return v
    return None, None


def display_name(name, wiki_name):
    m = re.match(r"^S(\d{4}) ([A-Z]) (\d+)$", name)
    if m:
        return f"S/{m.group(1)} {m.group(2)} {m.group(3)}"
    if wiki_name and not wiki_name.startswith("S/") and key(wiki_name) != key(name):
        return wiki_name
    return name


def main():
    elem_path, phys_path, wiki_path, out_path = sys.argv[1:5]
    elem = parse_elem(elem_path)
    phys = parse_phys(phys_path)
    wiki = parse_wiki(wiki_path)

    moons = []
    unmatched = []
    seen = set()
    for m in elem:
        # a few moons are listed once per ephemeris; keep the first
        if m["code"] in seen:
            continue
        seen.add(m["code"])
        wr, wiki_name = lookup_wiki(wiki, m["name"])
        m["name"] = display_name(m["name"], wiki_name)
        r = phys.get(m["code"], {}).get("radius")
        src = "jpl"
        if r is None:
            r = wr
            src = "wiki"
        if r is None:
            # typical size of the faint irregular moons discovered since 2000
            r = 1.5
            src = "default"
            unmatched.append(m["name"])
        m["radius"] = r
        m["radiusSource"] = src
        moons.append(m)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(moons, f, separators=(",", ":"))

    by_planet = {}
    for m in moons:
        by_planet[m["planet"]] = by_planet.get(m["planet"], 0) + 1
    print(f"{len(moons)} moons written; {len(wiki)} wiki radii; default radius used for {len(unmatched)}")
    print(by_planet)
    if unmatched:
        print("unmatched:", ", ".join(unmatched))


if __name__ == "__main__":
    main()
