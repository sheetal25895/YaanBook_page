"""Import DGCA's List of Non-Scheduled Operators (NSOP) into data/operators.json.

Usage (needs Python 3 and pdfplumber: pip install pdfplumber):
    python3 tools/import_dgca_nsop.py            # downloads the latest list from DGCA
    python3 tools/import_dgca_nsop.py file.pdf   # or parses a PDF you downloaded yourself

Phone numbers, e-mails and street addresses are deliberately not copied; the site links to the
official DGCA list instead.
"""
import datetime, json, os, re, sys, tempfile, urllib.request
import pdfplumber

URL = "https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/airOperation/certification/nonscheduled/ns-oper.pdf"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "operators.json")

CITIES = ["New Delhi", "Delhi", "Gurugram", "Gurgaon", "Noida", "Mumbai", "Navi Mumbai", "Pune", "Bengaluru", "Bangalore",
          "Hyderabad", "Secunderabad", "Chennai", "Kolkata", "Ahmedabad", "Gandhinagar", "Jaipur", "Lucknow", "Bhubaneswar",
          "Chandigarh", "Mohali", "Kochi", "Cochin", "Thiruvananthapuram", "Goa", "Nagpur", "Indore", "Bhopal", "Raipur",
          "Patna", "Ranchi", "Guwahati", "Dehradun", "Srinagar", "Jammu", "Visakhapatnam", "Vijayawada", "Coimbatore",
          "Surat", "Vadodara", "Nashik", "Aurangabad", "Udaipur", "Varanasi", "Kanpur", "Shillong", "Imphal", "Aizawl",
          "Port Blair", "Mangaluru", "Mysuru", "Baramati", "Angul", "Faridabad", "Ludhiana", "Amritsar", "Madurai"]
ALIAS = {"Bangalore": "Bengaluru", "Gurgaon": "Gurugram", "Cochin": "Kochi", "New Delhi": "Delhi", "Secunderabad": "Hyderabad"}
STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
          "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
          "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
          "West Bengal", "Delhi", "Jammu", "Chandigarh"]


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()


def place(address):
    a = address.replace("\n", " ")
    for c in CITIES:
        if re.search(r"\b" + re.escape(c) + r"\b", a, re.I):
            return ALIAS.get(c, c)
    for s in STATES:
        if re.search(r"\b" + re.escape(s) + r"\b", a, re.I):
            return s
    return ""


def parse(pdf_path):
    ops, cur, updated = [], None, ""
    with pdfplumber.open(pdf_path) as pdf:
        m = re.search(r"Updated as on\s*([\d.]+)", pdf.pages[0].extract_text() or "")
        updated = m.group(1) if m else ""
        # Every page after the first has operator no. 1's details printed again, invisibly, on top of
        # its first row. Record where those characters sit (page 2 has them on their own) and drop
        # them from every page, so the real operator underneath reads cleanly.
        key = lambda c: (c["text"], round(c["x0"], 1), round(c["top"], 1))
        band = [c for c in pdf.pages[1].chars if c["top"] < 152 and c["x0"] < 480] if len(pdf.pages) > 1 else []
        ghost = {key(c) for c in band} if "Aerokalinga" in "".join(c["text"] for c in band) else set()
        for pno, page in enumerate(pdf.pages):
            if pno > 0 and ghost:
                page = page.filter(lambda o: o.get("object_type") != "char" or key(o) not in ghost)
            for table in page.extract_tables():
                for row in table:
                    row = [(c or "") for c in row] + [""] * (11 - len(row))
                    sno, name, _contact, aop, valid, count, _fleet, kind, model, reg, seats = row[:11]
                    if not re.match(r"^(FW|RW|B)$", clean(kind)):
                        continue  # header rows
                    if clean(sno).isdigit():
                        cur = {"sno": int(clean(sno)), "name": clean(name.split("\n")[0]), "city": place(name),
                               "aop": clean(aop).replace(" ", ""), "valid": clean(valid), "declared": clean(count),
                               "aircraft": []}
                        # Company names sometimes wrap onto a second line
                        lines = [l.strip() for l in name.split("\n") if l.strip()]
                        if len(lines) > 1 and not re.search(r"(Ltd|Limited|LLP|India|Aviation|Airways|Corporation)\.?$", lines[0], re.I) \
                                and not re.match(r"^[\d#]|^(C/O|Plot|Flat|House|Office|Unit|Hangar)", lines[1], re.I):
                            cur["name"] = clean(lines[0] + " " + lines[1])
                        # Trim address text that follows the company suffix, keeping a brand in brackets
                        m = re.match(r"^(.*?\b(?:Ltd|Limited|LLP)\b\.?(?:\s*\([^)]*\))?)", cur["name"], re.I)
                        cur["name"] = (m.group(1) if m else cur["name"]).rstrip(" ,")
                        if cur["name"].endswith("Pvt."):
                            cur["name"] += " Ltd."
                        ops.append(cur)
                    elif cur is None:
                        continue
                    elif not cur["city"] and name:
                        cur["city"] = place(name)
                    cur["aircraft"].append({"kind": clean(kind), "model": clean(model), "reg": clean(reg).replace(" ", ""),
                                            "seats": clean(seats)})
    return updated, ops


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src:
        src = os.path.join(tempfile.gettempdir(), "dgca-ns-oper.pdf")
        print("Downloading", URL)
        urllib.request.urlretrieve(URL, src)
    updated, ops = parse(src)
    mismatched = [o["name"] for o in ops if o["declared"].isdigit() and int(o["declared"]) != len(o["aircraft"])]
    data = {"source": "Directorate General of Civil Aviation (DGCA), List of Non-Scheduled Operators",
            "sourceUrl": URL, "updated": updated, "imported": datetime.date.today().isoformat(), "operators": ops}
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print(f"Saved {len(ops)} operators, {sum(len(o['aircraft']) for o in ops)} aircraft (DGCA list dated {updated}) to data/operators.json")
    if mismatched:
        print(f"Note: {len(mismatched)} operators list a different aircraft count than rows found:", ", ".join(mismatched[:10]))


if __name__ == "__main__":
    main()
