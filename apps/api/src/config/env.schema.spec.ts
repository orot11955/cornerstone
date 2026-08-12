import { validateEnvironment } from './env.schema';

const requiredEnvironment = {
  WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnvironment', () => {
  it('applies defaults to optional environment values', () => {
    expect(validateEnvironment(requiredEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
    });
  });

  it('rejects missing secrets', () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        JWT_ACCESS_SECRET: undefined,
      }),
    ).toThrow();
  });

  it('rejects invalid ports', () => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, PORT: '70000' }),
    ).toThrow();
  });
});
