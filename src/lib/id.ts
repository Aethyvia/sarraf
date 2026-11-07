import { randomUUID } from 'expo-crypto';

/** A new permanent record id (UUID v4). Every row gets one; ids are never reused. */
export function newId(): string {
  return randomUUID();
}
