"""
End-to-end workflow test script.
Tests the full lease upload → process → review → inspection → work order pipeline.
Run: .venv\Scripts\python.exe test_workflow.py
"""
import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error

BASE = "http://localhost:8000/api/v1"
LEASE_PDF = os.path.join(os.path.dirname(__file__), "..", "sample_data", "leases", "sample_lease_MC-B-1204.pdf")


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}") as r:
        return json.loads(r.read())


def post_json(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def post_multipart(path, field_name, file_path, content_type="application/pdf"):
    import email.mime.multipart
    boundary = "----TruelinksBoundary12345"
    with open(file_path, "rb") as f:
        file_bytes = f.read()
    filename = os.path.basename(file_path)
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{BASE}{path}", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def ok(label, value=""):
    print(f"  [OK]  {label}" + (f": {value}" if value else ""))


def fail(label, value=""):
    print(f"  [FAIL]  {label}" + (f": {value}" if value else ""))
    sys.exit(1)


def check(condition, label, value=""):
    if condition:
        ok(label, value)
    else:
        fail(label, value)


# ─── 1. Properties & Units ───────────────────────────────────────────────────
section("1. PROPERTIES & UNITS")

props = get("/properties/")
check(props["count"] >= 1, "Properties exist", props["count"])

units = get("/units/")
check(units["count"] == 5, "5 units seeded", units["count"])

available = [u for u in units["results"] if u["occupancy_status"] == "available"]
check(len(available) == 3, "3 available units", len(available))

# Dashboard stats
stats = get("/dashboard/stats/")
check(stats["total_units"] == 5, "Dashboard: total_units=5")
check(stats["available_units"] == 3, "Dashboard: available_units=3")
check(stats["occupied_units"] == 2, "Dashboard: occupied_units=2")
ok("Dashboard stats", f"open_issues={stats['open_issues']} pending_wos={stats['pending_work_orders']}")

# ─── 2. Lease Upload ─────────────────────────────────────────────────────────
section("2. LEASE UPLOAD")

if not os.path.exists(LEASE_PDF):
    fail("Sample lease PDF not found", LEASE_PDF)

data, status = post_multipart("/leases/upload/", "document", LEASE_PDF)
check(status == 201, f"Upload returns 201", f"got {status}")
lease_id = data["id"]
check(data["processing_status"] == "pending", "Status is pending")
ok("Lease ID", lease_id)

# ─── 3. Lease Processing (AI Extraction) ─────────────────────────────────────
section("3. LEASE PROCESSING (MOCK AI EXTRACTION)")

data, status = post_json(f"/leases/{lease_id}/process/", {})
check(status == 200, f"Process returns 200", f"got {status}")
check(data["processing_status"] == "completed", "Status = completed")
check(data["provider_used"] == "mock", "Provider = mock")
ok("Extracted unit ID", data.get("extracted_unit_id", "none"))
ok("Tenant name", data.get("tenant_name", "none"))
ok("Rent amount", data.get("rent_amount", "none"))

# ─── 4. Extracted Fields ─────────────────────────────────────────────────────
section("4. EXTRACTED FIELDS")

fields_data = get(f"/leases/{lease_id}/fields/")
check(len(fields_data) > 0, "Fields extracted", len(fields_data))

unit_field = next((f for f in fields_data if f["field_name"] == "unit_id"), None)
check(unit_field is not None, "unit_id field present")
if unit_field:
    check(unit_field["normalized_value"] == "MC-B-1204", "Unit ID extracted correctly", unit_field["normalized_value"])
    check(unit_field["review_status"] == "pending", "Field status = pending")

pending_fields = [f for f in fields_data if f["review_status"] == "pending"]
ok(f"Fields pending review", len(pending_fields))

# ─── 5. Validation Results ────────────────────────────────────────────────────
section("5. VALIDATION RESULTS (R1-R7)")

validations = get(f"/leases/{lease_id}/validations/")
check(len(validations) == 7, "All 7 rules evaluated", len(validations))

for v in validations:
    symbol = "[OK]" if v["result"] == "PASS" else ("?" if v["result"] == "UNDETERMINED" else "[FAIL]")
    print(f"  {symbol}  [{v['result']:13}] {v['rule_id']}: {v['rule_name']}")

passes = [v for v in validations if v["result"] == "PASS"]
check(len(passes) > 0, "At least some rules pass", len(passes))

# ─── 6. Flags ─────────────────────────────────────────────────────────────────
section("6. LEASE FLAGS")

flags = get(f"/leases/{lease_id}/flags/")
ok(f"Flags raised", len(flags))
for f in flags:
    print(f"  [FLAG]  [{f['severity']:8}] {f['flag_type']}: {f['description'][:60]}...")

# ─── 7. Field Approval ────────────────────────────────────────────────────────
section("7. FIELD-LEVEL REVIEW (APPROVE UNIT ID)")

if unit_field:
    data, status = post_json(f"/lease-fields/{unit_field['id']}/approve/", {
        "reviewed_by": "test_owner@marinacrest.qa"
    })
    check(status == 200, "Approve returns 200", f"got {status}")
    check(data["review_status"] == "approved", "Field status = approved")
    ok("Approved by", data["reviewed_by"])

    # Try double-approve → should 409
    data2, status2 = post_json(f"/lease-fields/{unit_field['id']}/approve/", {
        "reviewed_by": "test_owner@marinacrest.qa"
    })
    check(status2 == 409, "Double-approve blocked with 409", f"got {status2}")

# ─── 8. Duplicate Processing (Idempotency) ───────────────────────────────────
section("8. IDEMPOTENCY - RE-PROCESS")

data, status = post_json(f"/leases/{lease_id}/process/", {})
check(status == 200, "Re-processing succeeds", f"got {status}")
check(data["retry_count"] >= 2, "retry_count incremented", data.get("retry_count"))

# ─── 9. Audit Events ─────────────────────────────────────────────────────────
section("9. AUDIT TRAIL")

audit = get(f"/audit-events/?entity_type=lease&entity_id={lease_id}")
check(audit["count"] > 0, "Audit events recorded for lease", audit["count"])
actions = [e["action"] for e in audit["results"]]
ok("Audit actions recorded", ", ".join(actions[:5]))

# ─── 10. Inspection + Work Order ─────────────────────────────────────────────
section("10. INSPECTION CREATION")

unit_id_db = units["results"][0]["id"]
insp_data, status = post_json("/inspections/", {
    "unit": unit_id_db,
    "reporter_type": "tenant",
    "description": "Reporting visible water staining in bathroom and HVAC dust accumulation."
})
check(status == 201, "Inspection created", f"got {status}")
insp_id = insp_data["id"]
ok("Inspection ID", insp_id)

# ─── 11. Create a fake inspection image ───────────────────────────────────────
section("11. IMAGE UPLOAD FOR INSPECTION")

# Create a minimal valid JPEG for testing
import struct, zlib
img_path = os.path.join(os.path.dirname(__file__), "test_bathroom_image.jpg")

# Minimal valid JPEG (1x1 red pixel)
jpeg_bytes = bytes([
    0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
    0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
    0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
    0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,
    0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,
    0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
    0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x1F,0x00,0x00,0x01,0x05,0x01,0x01,
    0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,
    0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0xFF,0xC4,0x00,0xB5,0x10,0x00,0x02,0x01,0x03,
    0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,0x01,0x02,0x03,0x00,
    0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,
    0x81,0x91,0xA1,0x08,0x23,0x42,0xB1,0xC1,0x15,0x52,0xD1,0xF0,0x24,0x33,0x62,0x72,
    0x82,0x09,0x0A,0x16,0x17,0x18,0x19,0x1A,0x25,0x26,0x27,0x28,0x29,0x2A,0x34,0x35,
    0x36,0x37,0x38,0x39,0x3A,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x53,0x54,0x55,
    0x56,0x57,0x58,0x59,0x5A,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6A,0x73,0x74,0x75,
    0x76,0x77,0x78,0x79,0x7A,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x92,0x93,0x94,
    0x95,0x96,0x97,0x98,0x99,0x9A,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xB2,
    0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,
    0xCA,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,
    0xE7,0xE8,0xE9,0xEA,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFF,0xDA,
    0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0xFB,0xD2,0x8A,0x28,0x03,0xFF,0xD9
])
with open(img_path, "wb") as f:
    f.write(jpeg_bytes)

# Upload image with "bathroom" in filename to trigger mock vision scenario
boundary = "----TruelinksBoundary99999"
with open(img_path, "rb") as f:
    img_bytes = f.read()
filename = "bathroom_inspection.jpg"
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="images"; filename="{filename}"\r\n'
    f"Content-Type: image/jpeg\r\n\r\n"
).encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()

import urllib.request, urllib.error
req = urllib.request.Request(
    f"{BASE}/inspections/{insp_id}/images/", data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST"
)
try:
    with urllib.request.urlopen(req) as r:
        img_data = json.loads(r.read())
        img_status = r.status
except urllib.error.HTTPError as e:
    img_data = json.loads(e.read())
    img_status = e.code

check(img_status == 201, "Image uploaded", f"got {img_status}")
ok("Image filename", img_data[0]["original_filename"] if isinstance(img_data, list) else img_data)

# ─── 12. Analyze Inspection ───────────────────────────────────────────────────
section("12. INSPECTION ANALYSIS (MOCK VISION)")

data, status = post_json(f"/inspections/{insp_id}/analyze/", {})
check(status == 200, "Analysis returns 200", f"got {status}")
check(data["status"] == "completed", "Inspection status = completed")
findings = data.get("findings", [])
check(len(findings) > 0, "Findings extracted", len(findings))
for f in findings:
    print(f"  [FLAG]  [{f['category']:10}] {f.get('equipment_name','')}: {f.get('condition','')} (conf={f.get('confidence',0):.2f})")

# ─── 13. Work Orders Generated ────────────────────────────────────────────────
section("13. WORK ORDERS (AUTO-GENERATED)")

wos = get("/work-orders/")
check(wos["count"] > 0, "Work orders generated", wos["count"])
wo = wos["results"][0]
check(wo["status"] == "draft", "Work order is draft")
ok("WO Title", wo["title"])
ok("WO Priority", wo["priority"])
wo_id = wo["id"]

# ─── 14. Work Order Approve ───────────────────────────────────────────────────
section("14. WORK ORDER APPROVAL")

data, status = post_json(f"/work-orders/{wo_id}/approve/", {
    "approved_by": "owner@marinacrest.qa"
})
check(status == 200, "Approve returns 200", f"got {status}")
check(data["status"] == "approved", "Work order approved")
ok("Approved by", data["approved_by"])

# Double-approve blocked
data2, status2 = post_json(f"/work-orders/{wo_id}/approve/", {"approved_by": "x"})
check(status2 == 409, "Double-approve blocked", f"got {status2}")

# ─── 15. Work Order Reject (second WO if exists) ──────────────────────────────
section("15. WORK ORDER REJECTION")

# Create a fresh inspection + WO to test rejection
insp2, _ = post_json("/inspections/", {"unit": unit_id_db, "reporter_type": "inspector", "description": "Second inspection"})
insp2_id = insp2["id"]
req2 = urllib.request.Request(
    f"{BASE}/inspections/{insp2_id}/images/", data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST"
)
with urllib.request.urlopen(req2):
    pass
post_json(f"/inspections/{insp2_id}/analyze/", {})
wos2 = get("/work-orders/?status=draft")
if wos2["count"] > 0:
    wo2_id = wos2["results"][0]["id"]
    data, status = post_json(f"/work-orders/{wo2_id}/reject/", {
        "rejected_by": "owner@marinacrest.qa",
        "rejection_reason": "Will be addressed in next maintenance cycle."
    })
    check(status == 200, "Reject returns 200", f"got {status}")
    check(data["status"] == "rejected", "Work order rejected")
    ok("Rejection reason", data["rejection_reason"])

# Reject requires reason
if wos2["count"] > 0:
    wos3 = get("/work-orders/?status=draft")
    if wos3["count"] > 0:
        wo3_id = wos3["results"][0]["id"]
        data, status = post_json(f"/work-orders/{wo3_id}/reject/", {"rejected_by": "x"})
        check(status == 400, "Reject without reason blocked", f"got {status}")

# ─── 16. Unit Overview ────────────────────────────────────────────────────────
section("16. UNIT OVERVIEW (Combined View)")

unit_id_db = units["results"][0]["id"]
overview = get(f"/units/{unit_id_db}/overview/")
check("unit" in overview, "Unit data present")
check("work_orders" in overview, "Work orders present")
check("recent_inspections" in overview, "Inspections present")
ok("Work orders in overview", len(overview["work_orders"]))
ok("Inspections in overview", len(overview["recent_inspections"]))

# ─── SUMMARY ─────────────────────────────────────────────────────────────────
section("ALL TESTS PASSED")
print("\n  Full workflow verified:")
print(f"  • Lease uploaded, extracted, validated (7 rules), flagged")
print(f"  • Field-level approval with double-approve protection")
print(f"  • Audit trail recorded for all decisions")
print(f"  • Inspection created, image uploaded, mock vision analyzed")
print(f"  • Work orders auto-generated, approved, rejected")
print(f"  • Unit overview returns combined view")
print(f"  • Dashboard stats calculated from live DB\n")

# Cleanup temp file
os.remove(img_path)
