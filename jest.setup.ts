// expo-crypto is native; tests use Node's UUIDs.
jest.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
