import { describe, expect, it } from 'vitest';
import { validateEnv } from './config.js';
const valid = {
  DATABASE_URL: 'postgresql://localhost/fixlens',
  SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  SPACES_KEY: 'key',
  SPACES_SECRET: 'secret',
  SPACES_BUCKET: 'bucket',
};
describe('environment', () => {
  it('lists missing variables clearly', () => {
    expect(() => validateEnv({})).toThrow(
      'SPACES_ENDPOINT, SPACES_KEY, SPACES_SECRET, SPACES_BUCKET',
    );
  });
  it('requires database credentials in either form', () => {
    expect(() => validateEnv({})).toThrow('DATABASE_HOST');
  });
  it('accepts discrete database parts without DATABASE_URL', () => {
    const { DATABASE_URL: _dropped, ...withoutUrl } = valid;
    expect(
      validateEnv({
        ...withoutUrl,
        DATABASE_HOST: 'db.example.com',
        DATABASE_PORT: '25060',
        DATABASE_NAME: 'fixlensdb',
        DATABASE_USERNAME: 'fixlensdb',
        DATABASE_PASSWORD: 'secret',
        DATABASE_SSL: 'require',
      }).PORT,
    ).toBe(3000);
  });
  it('rejects invalid discrete database port', () => {
    const { DATABASE_URL: _dropped, ...withoutUrl } = valid;
    expect(() =>
      validateEnv({
        ...withoutUrl,
        DATABASE_HOST: 'db.example.com',
        DATABASE_PORT: 'abc',
        DATABASE_NAME: 'fixlensdb',
        DATABASE_USERNAME: 'fixlensdb',
        DATABASE_PASSWORD: 'secret',
      }),
    ).toThrow('DATABASE_PORT');
  });
  it('defaults the port', () => {
    expect(validateEnv(valid).PORT).toBe(3000);
  });
  it.each(['0', '65536', 'abc', '3.5'])('rejects invalid port %s', (PORT) => {
    expect(() => validateEnv({ ...valid, PORT })).toThrow('PORT');
  });
  it('rejects invalid database protocol', () => {
    expect(() =>
      validateEnv({ ...valid, DATABASE_URL: 'https://example.com' }),
    ).toThrow('DATABASE_URL');
  });
});
