// expo-crypto is native; tests use Node's crypto.
jest.mock('expo-crypto', () => ({
  randomUUID: () => crypto.randomUUID(),
  getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)),
}));
