import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";

const UPLOAD_DIR =
  process.env.FILE_UPLOAD_DIR ||
  path.join(process.cwd(), "uploads", "partner-documents");

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

/**
 * Allowed KYC document types, validated by file SIGNATURE (magic bytes) — never by the
 * user-supplied filename. A provider could otherwise upload `kyc.pdf` whose bytes are
 * actually HTML/SVG and trigger stored XSS when an admin opens it during review.
 * The stored extension/format is derived from the sniffed type, not the claimed name.
 */
const FILE_SIGNATURES: { format: "pdf" | "jpg" | "png" | "webp"; test: (b: Buffer) => boolean }[] = [
  { format: "pdf", test: (b) => b.length > 4 && b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { format: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { format: "png", test: (b) => b.length > 8 && b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" },
  {
    format: "webp",
    test: (b) =>
      b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/** Returns the detected document format, or null if the bytes are not an allowed type. */
export function detectDocumentFormat(buffer: Buffer): "pdf" | "jpg" | "png" | "webp" | null {
  return FILE_SIGNATURES.find((s) => s.test(buffer))?.format ?? null;
}

export class DocumentUploadService {
  private ensureDir() {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  }

  async assertProviderOwnership(providerId: string, userId: string): Promise<void> {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider || provider.userId !== userId) {
      throw new Error("FORBIDDEN:You do not own this provider registration");
    }
  }

  async uploadDocument(
    providerId: string,
    userId: string,
    file: Buffer,
    fileName: string,
    documentType: string,
  ): Promise<{ documentId: string; documentUrl: string }> {
    if (file.length > MAX_FILE_SIZE) {
      throw new Error("File exceeds maximum size (5MB)");
    }

    // Content-based type check — reject anything that isn't a real PDF/JPG/PNG/WEBP,
    // regardless of the filename the client claims (defends against stored XSS / RCE).
    const fileFormat = detectDocumentFormat(file);
    if (!fileFormat) {
      throw new Error("INVALID_FILE_TYPE:Only PDF, JPG, PNG, or WEBP documents are allowed");
    }

    await this.assertProviderOwnership(providerId, userId);

    this.ensureDir();

    const ext = `.${fileFormat}`;
    const uniqueName = `${providerId}-${documentType}-${Date.now()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, uniqueName);

    fs.writeFileSync(filePath, file);

    const documentUrl = `/uploads/partner-documents/${uniqueName}`;
    const document = await prisma.providerDocument.create({
      data: {
        providerId,
        documentType,
        documentName: fileName,
        documentNumber: "",
        documentUrl,
        fileSize: file.length,
        fileFormat,
        uploadStatus: "uploaded",
      },
    });

    return { documentId: document.id, documentUrl };
  }

  async listDocuments(providerId: string, userId: string) {
    await this.assertProviderOwnership(providerId, userId);
    return prisma.providerDocument.findMany({
      where: { providerId },
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        documentType: true,
        documentName: true,
        documentUrl: true,
        fileSize: true,
        fileFormat: true,
        uploadStatus: true,
        uploadedAt: true,
        isVerified: true,
      },
    });
  }

  async deleteDocument(documentId: string, userId: string): Promise<void> {
    const doc = await prisma.providerDocument.findUnique({
      where: { id: documentId },
      include: { provider: { select: { userId: true } } },
    });
    if (!doc) return;
    if (doc.provider.userId !== userId) throw new Error("FORBIDDEN:You do not own this document");

    const basename = path.basename(doc.documentUrl);
    const filePath = path.join(UPLOAD_DIR, basename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.providerDocument.delete({ where: { id: documentId } });
  }

  resolveFilePath(documentUrl: string): string | null {
    const basename = path.basename(documentUrl);
    const filePath = path.join(UPLOAD_DIR, basename);
    return fs.existsSync(filePath) ? filePath : null;
  }

  async verifyDocument(documentId: string, adminId: string, notes?: string) {
    return prisma.providerDocument.update({
      where: { id: documentId },
      data: { isVerified: true, verifiedAt: new Date(), verificationNotes: notes ?? null },
    });
  }

  async rejectDocument(documentId: string, reason: string) {
    return prisma.providerDocument.update({
      where: { id: documentId },
      data: { isVerified: false, verificationNotes: reason },
    });
  }

  async listAllPending(limit = 50) {
    return prisma.providerDocument.findMany({
      where: { isVerified: false },
      orderBy: { uploadedAt: "desc" },
      take: limit,
      include: {
        provider: {
          select: {
            id: true,
            businessName: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
  }
}

export const documentUploadService = new DocumentUploadService();
