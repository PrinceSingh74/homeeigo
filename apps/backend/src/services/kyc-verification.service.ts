/**
 * KYC verification — testing mode: format validation only.
 */
export class KYCVerificationService {
  validatePAN(pan: string): { valid: boolean; error?: string } {
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;
    if (!panRegex.test(pan)) {
      return {
        valid: false,
        error: "Invalid PAN format. Should be like AAAAA1234B",
      };
    }
    return { valid: true };
  }

  validateAadhar(aadhar: string): { valid: boolean; error?: string } {
    if (!/^\d{12}$/.test(aadhar)) {
      return { valid: false, error: "Invalid Aadhar. Should be 12 digits" };
    }
    return { valid: true };
  }

  validateGST(gst: string): { valid: boolean; error?: string } {
    const gstRegex =
      /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{1}Z[0-9A-Z]{1}$/i;
    if (gst && !gstRegex.test(gst)) {
      return { valid: false, error: "Invalid GST format" };
    }
    return { valid: true };
  }

  async verifyKYC(
    pan?: string,
    aadhar?: string,
    gst?: string,
  ): Promise<{ verified: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (pan) {
      const panCheck = this.validatePAN(pan);
      if (!panCheck.valid) errors.push(panCheck.error ?? "Invalid PAN");
    }

    if (aadhar) {
      const aadharCheck = this.validateAadhar(aadhar);
      if (!aadharCheck.valid) errors.push(aadharCheck.error ?? "Invalid Aadhar");
    }

    if (gst) {
      const gstCheck = this.validateGST(gst);
      if (!gstCheck.valid) errors.push(gstCheck.error ?? "Invalid GST");
    }

    return { verified: errors.length === 0, errors };
  }
}

export const kycVerificationService = new KYCVerificationService();
