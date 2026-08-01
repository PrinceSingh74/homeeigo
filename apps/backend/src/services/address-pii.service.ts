import type { Address, Prisma } from "@prisma/client";
import { encryptionService } from "./encryption.service";

export type AddressPiiInput = {
  addressLine1: string;
  addressLine2?: string | null;
  fullAddress: string;
  landmark?: string | null;
  specialInstructions?: string | null;
};

/**
 * Exact shape buildEncryptedCreateFields returns: the nulled plaintext columns +
 * the encrypted columns + encryption metadata. Typed precisely (not the broad
 * AddressCreateInput) so the caller's `...spread` does NOT falsely claim label /
 * city / lat / long — those stay sourced from the caller's explicit fields.
 */
export type EncryptedAddressCreateFields = Pick<
  Prisma.AddressUncheckedCreateInput,
  | "addressLine1"
  | "addressLine2"
  | "fullAddress"
  | "landmark"
  | "specialInstructions"
  | "addressLine1Encrypted"
  | "addressLine2Encrypted"
  | "fullAddressEncrypted"
  | "landmarkEncrypted"
  | "specialInstructionsEncrypted"
  | "addressPayloadHash"
  | "encryptionKeyVersion"
  | "dataEncryptionStatus"
>;

function payloadFingerprint(input: AddressPiiInput): string {
  return [input.addressLine1, input.addressLine2 ?? "", input.fullAddress, input.landmark ?? "", input.specialInstructions ?? ""].join("|");
}

export class AddressPiiService {
  async buildEncryptedCreateFields(
    input: AddressPiiInput,
    actorId?: string,
  ): Promise<EncryptedAddressCreateFields> {
    const enc = await this.encryptPayload(input, actorId);
    return {
      addressLine1: null,
      addressLine2: null,
      fullAddress: null,
      landmark: null,
      specialInstructions: null,
      ...enc,
      dataEncryptionStatus: "ENCRYPTED",
    };
  }

  async buildEncryptedUpdateFields(
    input: Partial<AddressPiiInput>,
    existing: Pick<Address, "addressLine1" | "addressLine2" | "fullAddress" | "landmark" | "specialInstructions" | "addressLine1Encrypted" | "addressLine2Encrypted" | "fullAddressEncrypted" | "landmarkEncrypted" | "specialInstructionsEncrypted">,
    actorId?: string,
  ): Promise<Prisma.AddressUpdateInput> {
    const merged: AddressPiiInput = {
      addressLine1: input.addressLine1 ?? (await this.resolveLine1(existing)) ?? "",
      addressLine2: input.addressLine2 !== undefined ? input.addressLine2 : await this.resolveLine2(existing),
      fullAddress: input.fullAddress ?? (await this.resolveFullAddress(existing)) ?? "",
      landmark: input.landmark !== undefined ? input.landmark : await this.resolveLandmark(existing),
      specialInstructions:
        input.specialInstructions !== undefined
          ? input.specialInstructions
          : await this.resolveSpecialInstructions(existing),
    };
    const enc = await this.encryptPayload(merged, actorId);
    return {
      addressLine1: null,
      addressLine2: null,
      fullAddress: null,
      landmark: null,
      specialInstructions: null,
      ...enc,
      dataEncryptionStatus: "ENCRYPTED",
    };
  }

  private async encryptPayload(input: AddressPiiInput, actorId?: string) {
    const [line1, line2, full, landmark, instructions] = await Promise.all([
      encryptionService.encrypt(input.addressLine1, "PII", actorId),
      input.addressLine2
        ? encryptionService.encrypt(input.addressLine2, "PII", actorId)
        : Promise.resolve(null),
      encryptionService.encrypt(input.fullAddress, "PII", actorId),
      input.landmark ? encryptionService.encrypt(input.landmark, "PII", actorId) : Promise.resolve(null),
      input.specialInstructions
        ? encryptionService.encrypt(input.specialInstructions, "PII", actorId)
        : Promise.resolve(null),
    ]);

    return {
      addressLine1Encrypted: line1.ciphertext,
      addressLine2Encrypted: line2?.ciphertext ?? null,
      fullAddressEncrypted: full.ciphertext,
      landmarkEncrypted: landmark?.ciphertext ?? null,
      specialInstructionsEncrypted: instructions?.ciphertext ?? null,
      addressPayloadHash: encryptionService.createDeterministicHash(payloadFingerprint(input)),
      encryptionKeyVersion: line1.keyVersion,
    };
  }

  async resolveLine1(a: Pick<Address, "addressLine1" | "addressLine1Encrypted">): Promise<string | null> {
    if (a.addressLine1) return a.addressLine1;
    if (!a.addressLine1Encrypted) return null;
    return encryptionService.decrypt(a.addressLine1Encrypted, "PII");
  }

  async resolveLine2(a: Pick<Address, "addressLine2" | "addressLine2Encrypted">): Promise<string | null> {
    if (a.addressLine2) return a.addressLine2;
    if (!a.addressLine2Encrypted) return null;
    return encryptionService.decrypt(a.addressLine2Encrypted, "PII");
  }

  async resolveFullAddress(a: Pick<Address, "fullAddress" | "fullAddressEncrypted">): Promise<string | null> {
    if (a.fullAddress) return a.fullAddress;
    if (!a.fullAddressEncrypted) return null;
    return encryptionService.decrypt(a.fullAddressEncrypted, "PII");
  }

  async resolveLandmark(a: Pick<Address, "landmark" | "landmarkEncrypted">): Promise<string | null> {
    if (a.landmark) return a.landmark;
    if (!a.landmarkEncrypted) return null;
    return encryptionService.decrypt(a.landmarkEncrypted, "PII");
  }

  async resolveSpecialInstructions(
    a: Pick<Address, "specialInstructions" | "specialInstructionsEncrypted">,
  ): Promise<string | null> {
    if (a.specialInstructions) return a.specialInstructions;
    if (!a.specialInstructionsEncrypted) return null;
    return encryptionService.decrypt(a.specialInstructionsEncrypted, "PII");
  }

  async withDecrypted<T extends Address>(row: T) {
    const [addressLine1, addressLine2, fullAddress, landmark, specialInstructions] = await Promise.all([
      this.resolveLine1(row),
      this.resolveLine2(row),
      this.resolveFullAddress(row),
      this.resolveLandmark(row),
      this.resolveSpecialInstructions(row),
    ]);
    return {
      ...row,
      addressLine1: addressLine1 ?? "",
      addressLine2,
      fullAddress: fullAddress ?? "",
      landmark,
      specialInstructions,
    };
  }

  /**
   * Build a decrypted, navigation-ready address for an authorized fulfilment view
   * (the assigned provider going to deliver, or the owning customer). PII is stored
   * encrypted with blank plaintext columns, so this resolves the real values.
   */
  async viewForFulfilment(a: FulfilmentAddress) {
    const [fullAddress, addressLine1, addressLine2, landmark, specialInstructions] = await Promise.all([
      this.resolveFullAddress(a),
      this.resolveLine1(a),
      this.resolveLine2(a),
      this.resolveLandmark(a),
      this.resolveSpecialInstructions(a),
    ]);
    return {
      label: a.label,
      fullAddress: fullAddress || [addressLine1, a.city, a.state, a.zipCode].filter(Boolean).join(", "),
      addressLine1,
      addressLine2,
      buildingName: a.buildingName,
      flatNumber: a.flatNumber,
      landmark,
      specialInstructions,
      city: a.city,
      state: a.state,
      zipCode: a.zipCode,
      latitude: a.latitude,
      longitude: a.longitude,
    };
  }
}

export type FulfilmentAddress = Pick<
  Address,
  | "label"
  | "addressLine1"
  | "addressLine1Encrypted"
  | "addressLine2"
  | "addressLine2Encrypted"
  | "fullAddress"
  | "fullAddressEncrypted"
  | "buildingName"
  | "flatNumber"
  | "landmark"
  | "landmarkEncrypted"
  | "specialInstructions"
  | "specialInstructionsEncrypted"
  | "city"
  | "state"
  | "zipCode"
  | "latitude"
  | "longitude"
>;

export const addressPiiService = new AddressPiiService();
