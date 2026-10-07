"""
Creates a sample lease PDF for testing.
Run: .venv\Scripts\python.exe create_sample_lease.py
"""
import fitz
import os

def create_lease_pdf(output_path: str):
    doc = fitz.open()
    page = doc.new_page()

    lease_text = """
RESIDENTIAL LEASE AGREEMENT

Property: Marina Crest Residences, Lusail Marina District, Doha, Qatar

PARTIES

Landlord: Marina Crest Holdings W.L.L.
Landlord Address: Lusail Marina District, Doha, Qatar

Tenant: Ahmed Abdullah Al-Mansouri
Tenant ID: QID-28765432101

LEASED PREMISES

Unit: MC-B-1204
Apartment 1204, Tower B
Marina Crest Residences
Lusail Marina District, Doha, Qatar

LEASE TERM

Commencement Date: 01/01/2025
Expiry Date: 31/12/2025

RENT AND PAYMENT

Monthly Rent: QAR 12,000
Annual Rent: QAR 144,000
Currency: QAR
Rent Frequency: Monthly
Payment due on the 1st of each month.

SECURITY DEPOSIT

Security Deposit: QAR 12,000
The security deposit is refundable upon termination of the lease,
subject to inspection and deduction for damages beyond normal wear.

RENT ESCALATION

Escalation Clause: Rent shall increase by 5% per annum on each anniversary
of the commencement date, provided 60 days prior written notice is given.

RENEWAL

Renewal Terms: Either party may renew this lease for an additional 12-month term
by providing 60 days written notice before the expiry date. Renewal is subject
to the landlord's approval and updated rent terms.

TERMINATION

Termination: Either party may terminate this lease with 3 months written notice.
Early termination by the tenant will result in forfeiture of the security deposit.

GENERAL CONDITIONS

1. The tenant shall maintain the unit in good condition.
2. Subletting is not permitted without landlord written consent.
3. Pets are not permitted on the premises.
4. The landlord reserves the right to inspect the unit with 24 hours notice.

SIGNATURES

Landlord Signature: ___________________________
Name: Marina Crest Holdings W.L.L. Representative
Date: 01/01/2025

Tenant Signature: ___________________________
Name: Ahmed Abdullah Al-Mansouri
Date: 01/01/2025
"""

    page.insert_text((50, 50), lease_text, fontsize=10)
    doc.save(output_path)
    doc.close()
    print(f"Created: {output_path}")

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "sample_data", "leases", "sample_lease_MC-B-1204.pdf")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    create_lease_pdf(out)
