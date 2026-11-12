"""Writes the sample notes PDF (public/) and its page texts (src/data/), from the text below.

The sample deck's source quotes must all appear in these pages; a test checks that.
Run from the repo root:  python scripts/make-sample-pdf.py
"""
import json
import textwrap

TITLE = "Thermodynamics basics"

PAGES = [
    "Zeroth law of thermodynamics. If two systems are each in thermal equilibrium with a third system, they are in thermal "
    "equilibrium with each other. Two systems in thermal equilibrium have the same temperature. Temperature is what a "
    "thermometer measures. Heat is energy that flows from a hotter body to a colder one.",
    "First law of thermodynamics. Energy cannot be created or destroyed, only transferred or converted. The change in "
    "internal energy equals the heat added minus the work done by the system. An isolated system exchanges neither matter "
    "nor energy with its surroundings. A closed system exchanges energy but not matter. An open system exchanges both "
    "matter and energy.",
    "Second law of thermodynamics. The entropy of an isolated system never decreases. Heat flows spontaneously from hot to "
    "cold, never the other way without work. A reversible process is an idealisation in which the entropy stays constant. "
    "Third law of thermodynamics. As temperature approaches absolute zero, the entropy of a perfect crystal approaches "
    "zero. Absolute zero is 0 kelvin, or minus 273.15 degrees Celsius, and cannot be reached in a finite number of steps.",
    "Entropy. Entropy is a measure of the disorder of a system, or the number of microscopic arrangements that match its "
    "overall state. Ice melting increases entropy. A gas expanding into a vacuum also increases entropy. Entropy is "
    "measured in joules per kelvin.",
    "Heat engines. A heat engine turns heat into work by moving heat from a hot reservoir to a cold reservoir. Car engines "
    "and power stations are heat engines. Efficiency is the work done divided by the heat taken from the hot reservoir. "
    "Some heat must be rejected to the cold reservoir, as required by the second law, so no heat engine can be 100% "
    "efficient.",
    "Carnot efficiency. Carnot efficiency is the maximum efficiency of a heat engine between two reservoirs: 1 - Tc/Th, "
    "where Tc is the cold temperature and Th is the hot temperature. All temperatures must be in kelvin. Real engines "
    "always fall short of this limit. A refrigerator is a heat engine run backwards: it uses work to move heat from cold "
    "to hot.",
]


def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


objs = []


def add(body):
    objs.append(body)
    return len(objs)


font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
content_ids = []
for n, text in enumerate(PAGES, 1):
    ops = ["BT", "/F2 16 Tf", "50 790 Td", f"({esc(TITLE)} - page {n}) Tj", "/F1 12 Tf", "0 -30 Td", "18 TL"]
    for line in textwrap.wrap(text, 80):
        ops.append(f"({esc(line)}) '")
    ops.append("ET")
    stream = "\n".join(ops)
    content_ids.append(add(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"))
pages_id = len(objs) + len(PAGES) + 1
page_ids = [
    add(
        f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] /Contents {c} 0 R "
        f"/Resources << /Font << /F1 {font} 0 R /F2 {bold} 0 R >> >> >>"
    )
    for c in content_ids
]
assert add(f"<< /Type /Pages /Count {len(PAGES)} /Kids [{' '.join(f'{p} 0 R' for p in page_ids)}] >>") == pages_id
info = add(f"<< /Title ({esc(TITLE)} (sample notes)) >>")
catalog = add(f"<< /Type /Catalog /Pages {pages_id} 0 R /Lang (en-US) >>")

out = bytearray(b"%PDF-1.4\n")
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(out))
    out += f"{i} 0 obj\n{o}\nendobj\n".encode("latin-1")
xref = len(out)
out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode()
out += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()

open("public/sample-thermodynamics-notes.pdf", "wb").write(bytes(out))
json.dump(PAGES, open("src/data/sample-pages.json", "w", encoding="utf-8"), indent=2)
print("wrote", len(out), "bytes,", len(PAGES), "pages")
