import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";

const UPLOAD_DIR =
  process.env.FILE_UPLOAD_DIR ||
  path.join(process.cwd(), "uploads", "partner-documents");

const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

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

    await this.assertProviderOwnership(providerId, userId);

    this.ensureDir();

    const ext = path.extname(fileName) || ".bin";
    const fileFormat = ext.replace(".", "").toLowerCase() || "bin";
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
}

export const documentUploadService = new DocumentUploadService();
