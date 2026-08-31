import { z } from 'npm:zod@3.23.8';

const uuid = z.string().uuid();
const coordinate = z.object({
  displayAddress: z.string().trim().min(5).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  provider: z.string().trim().min(2).max(40),
  reference: z.string().trim().max(300).nullable().optional(),
});

export const createSpaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  avatarKey: z.enum(['bus','van','coach']).default('bus'),
  defaultLanguage: z.enum(['nl','fr']).default('nl'),
  capacity: z.number().int().min(1).max(120),
  start: coordinate,
  end: coordinate.nullable().optional(),
});

export const createStopSchema = z.object({
  location: coordinate,
  label: z.string().trim().min(1).max(100).nullable().optional(),
  expectedPassengerCount: z.number().int().min(0).max(120),
  passengerNames: z.array(z.string().trim().min(1).max(50)).max(120).default([]),
});

export const updateStopSchema = createStopSchema.partial().extend({
  location: coordinate.optional(),
});

export const passengerSchema = z.object({
  stopId: uuid,
  displayName: z.string().trim().min(1).max(50),
  avatarKey: z.enum(['initials-blue','initials-green','initials-purple','initials-orange','initials-rose']).default('initials-blue'),
});

export const parentAccessSchema = z.object({
  parentDisplayName: z.string().trim().min(1).max(50),
  passengerIds: z.array(uuid).min(1).max(12),
});

export const activateParentSchema = z.object({
  code: z.string().trim().min(8).max(20),
});

export const optimizeRouteSchema = z.object({
  mode: z.enum(['AUTOMATIC','MANUAL']).default('AUTOMATIC'),
  stopIds: z.array(uuid).min(1).max(100).optional(),
  roundTrip: z.boolean().default(false),
});

export const attendanceSchema = z.object({
  passengerId: uuid,
  status: z.enum(['BOARDED','MISSED','DROPPED_OFF']),
  expectedVersion: z.number().int().positive(),
});

export const locationSchema = z.object({
  driverSessionId: uuid,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(5000).nullable().optional(),
  speedMps: z.number().min(0).max(80).nullable().optional(),
  capturedAt: z.string().datetime(),
});

export const transitionSchema = z.object({
  transition: z.enum(['START','ARRIVE','COMPLETE','CANCEL']),
});

export const stopActionSchema = z.object({
  action: z.enum(['APPROACH','ARRIVE','COMPLETE','SKIP']),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(20).max(500), auth: z.string().min(8).max(500) }),
});

export const idempotencyKeySchema = z.string().uuid();
export type BusSpaceRole = 'OWNER' | 'DRIVER' | 'ATTENDANT';
