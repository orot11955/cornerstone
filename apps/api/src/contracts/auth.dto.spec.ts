import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterRequestDto } from './auth.dto.js';

describe('authentication DTO contract', () => {
  it('normalizes email and rejects forged mass-assignment fields', async () => {
    const input = plainToInstance(RegisterRequestDto, {
      email: '  USER@Example.COM  ',
      password: 'correct horse battery staple',
      role: 'admin',
      passwordHash: 'forged',
    });
    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(input.email).toBe('user@example.com');
    expect(errors.map((error) => error.property).sort()).toEqual([
      'passwordHash',
      'role',
    ]);
  });

  it('rejects short passwords without logging or transforming them', async () => {
    const input = plainToInstance(RegisterRequestDto, {
      email: 'user@example.com',
      password: 'short',
    });
    const errors = await validate(input);

    expect(errors).toEqual([expect.objectContaining({ property: 'password' })]);
    expect(input.password).toBe('short');
  });

  it('limits passwords to 128 Unicode code points', async () => {
    const accepted = plainToInstance(RegisterRequestDto, {
      email: 'user@example.com',
      password: '🔐'.repeat(128),
    });
    const rejected = plainToInstance(RegisterRequestDto, {
      email: 'user@example.com',
      password: '🔐'.repeat(129),
    });

    await expect(validate(accepted)).resolves.toEqual([]);
    await expect(validate(rejected)).resolves.toEqual([
      expect.objectContaining({ property: 'password' }),
    ]);
  });
});
