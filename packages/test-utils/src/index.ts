export function createTestDatabaseUrl(name = `opstage-test-${Date.now()}`): string {
  return `file:./data/${name}.db`;
}
