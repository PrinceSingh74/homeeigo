import { TrackingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { distanceKm, etaMinutes } from "../lib/geo";
import { createWsEnvelope, pushToBookingTracking } from "./notification-hub";
import { roomManager, MessageType, WSMessage } from "../lib/websocket";

export interface LocationUpdatePayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
}

export interface TrackingData {
  bookingId: string;
  currentLat: number;
  currentLng: number;
  destLat: number;
  destLng: number;
  distance: number;
  eta: number;
  bearing?: number;
  speed?: number;
}

export class TrackingService {
  private calculateBearing(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }

  async updateLocationV2(
    bookingId: string,
    providerId: string,
    location: LocationUpdatePayload
  ): Promise<TrackingData | null> {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { address: true },
      });

      if (!booking) {
        throw new Error(`Booking ${bookingId} not found`);
      }

      const distance = distanceKm(
        location.latitude,
        location.longitude,
        booking.address.latitude,
        booking.address.longitude
      );

      const eta = etaMinutes(distance);
      const bearing = this.calculateBearing(
        location.latitude,
        location.longitude,
        booking.address.latitude,
        booking.address.longitude
      );

      const hasArrived = distance < 0.1;

      const tracking = await prisma.tracking.upsert({
        where: { bookingId },
        create: {
          bookingId,
          status: hasArrived ? TrackingStatus.ARRIVED : TrackingStatus.ON_THE_WAY,
          totalDistance: distance,
          estimatedArrivalTime: new Date(Date.now() + eta * 60 * 1000),
        },
        update: {
          status: hasArrived ? TrackingStatus.ARRIVED : TrackingStatus.ON_THE_WAY,
          totalDistance: distance,
          estimatedArrivalTime: new Date(Date.now() + eta * 60 * 1000),
          lastUpdateAt: new Date(),
        },
      });

      await prisma.locationHistory.create({
        data: {
          trackingId: tracking.id,
          providerId,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          speed: location.speed,
          distance,
          eta,
          bearing,
          hasArrived,
        },
      });

      await prisma.location.upsert({
        where: { providerId },
        create: {
          providerId,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
        },
        update: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
        },
      });

      await prisma.booking.update({
        where: { id: bookingId },
        data: { eta },
      });

      const trackingData: TrackingData = {
        bookingId,
        currentLat: location.latitude,
        currentLng: location.longitude,
        destLat: booking.address.latitude,
        destLng: booking.address.longitude,
        distance: Math.round(distance * 10) / 10,
        eta,
        bearing,
        speed: location.speed,
      };

      const message: WSMessage = {
        type: MessageType.LOCATION_UPDATE,
        data: trackingData,
        timestamp: new Date(),
        sender: { userId: providerId, userType: "vendor" },
      };

      roomManager.broadcast(`tracking:${bookingId}`, message);

      if (hasArrived) {
        await this.notifyArrival(bookingId, booking.userId);
      }

      return trackingData;
    } catch (error) {
      console.error("[Tracking V2] Location update error:", error);
      throw error;
    }
  }

  private async notifyArrival(bookingId: string, customerId: string): Promise<void> {
    const message: WSMessage = {
      type: MessageType.ARRIVAL,
      data: {
        bookingId,
        message: "Provider has arrived",
        timestamp: new Date(),
      },
      timestamp: new Date(),
    };

    roomManager.sendToUser(customerId, message);

    await prisma.notification.create({
      data: {
        userId: customerId,
        type: "ARRIVAL",
        title: "Provider Arrived",
        message: "Your service provider has arrived at your location",
        body: "Your service provider has arrived at your location",
        bookingId,
      },
    });
  }

  async getLatestLocation(bookingId: string) {
    const tracking = await prisma.tracking.findUnique({
      where: { bookingId },
      include: {
        locationHistory: {
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
    });

    return tracking?.locationHistory[0] || null;
  }

  async updateLocation(
    providerId: string,
    body: {
      bookingId: string;
      latitude: number;
      longitude: number;
      accuracy?: number;
      altitude?: number;
    },
  ) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: body.bookingId,
        providerId,
        status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
      },
      include: { address: true, tracking: true },
    });
    if (!booking) return null;

    const tracking = await prisma.tracking.upsert({
      where: { bookingId: body.bookingId },
      create: {
        bookingId: body.bookingId,
        status: TrackingStatus.ON_THE_WAY,
      },
      update: { lastUpdateAt: new Date() },
    });

    await prisma.locationHistory.create({
      data: {
        trackingId: tracking.id,
        providerId,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        altitude: body.altitude,
      },
    });

    await prisma.location.upsert({
      where: { providerId },
      create: {
        providerId,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      },
      update: {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      },
    });

    const dist = distanceKm(
      body.latitude,
      body.longitude,
      booking.address.latitude,
      booking.address.longitude,
    );
    const eta = etaMinutes(dist);
    const estimatedArrivalTime = new Date(Date.now() + eta * 60 * 1000);

    await prisma.tracking.update({
      where: { id: tracking.id },
      data: {
        status: TrackingStatus.ON_THE_WAY,
        totalDistance: dist,
        estimatedArrivalTime,
        lastUpdateAt: new Date(),
      },
    });

    await prisma.booking.update({
      where: { id: body.bookingId },
      data: { eta },
    });

    const nowIso = new Date().toISOString();
    const payload = createWsEnvelope("tracking.location_update", {
      bookingId: body.bookingId,
      latitude: body.latitude,
      longitude: body.longitude,
      providerLatitude: body.latitude,
      providerLongitude: body.longitude,
      distance: Math.round(dist * 10) / 10,
      eta,
      estimatedArrivalTime: estimatedArrivalTime.toISOString(),
      status: "on_the_way",
      locationUpdatedAt: nowIso,
    }, body.bookingId);
    pushToBookingTracking(body.bookingId, payload);

    return payload;
  }

  async get(bookingId: string, userId?: string, providerId?: string) {
    const booking = await prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...(userId ? { userId } : {}),
        ...(providerId ? { providerId } : {}),
      },
      include: {
        tracking: true,
        provider: { include: { currentLocation: true } },
        address: true,
      },
    });
    if (!booking?.tracking) return null;

    const loc = booking.provider?.currentLocation;
    let dist = booking.tracking.totalDistance;
    if (loc && booking.address) {
      dist = distanceKm(loc.latitude, loc.longitude, booking.address.latitude, booking.address.longitude);
    }

    return {
      id: booking.tracking.id,
      bookingId,
      status: booking.tracking.status.toLowerCase(),
      providerLatitude: loc?.latitude,
      providerLongitude: loc?.longitude,
      distance: dist ? Math.round(dist * 10) / 10 : null,
      eta: booking.eta,
      estimatedArrivalTime: booking.tracking.estimatedArrivalTime,
      locationUpdatedAt: booking.tracking.lastUpdateAt,
    };
  }
}

export const trackingService = new TrackingService();
