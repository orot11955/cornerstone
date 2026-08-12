export const passwordRuntimeDefaults = Object.freeze({
  memoryCostKib: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

export const passwordRuntimeBounds = Object.freeze({
  memoryCostKib: { min: 19_456, max: 262_144 },
  timeCost: { min: 2, max: 5 },
  parallelism: { min: 1, max: 4 },
});

export interface PasswordRuntimeEnvironment {
  readonly ARGON2_MEMORY_KIB?: unknown;
  readonly ARGON2_TIME_COST?: unknown;
  readonly ARGON2_PARALLELISM?: unknown;
}

export interface PasswordRuntimeParameters {
  readonly memoryCostKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly hashLength: number;
}

export function resolvePasswordRuntimeParameters(
  environment: PasswordRuntimeEnvironment,
): PasswordRuntimeParameters {
  const memoryCostKib = integer(
    environment.ARGON2_MEMORY_KIB,
    passwordRuntimeDefaults.memoryCostKib,
    passwordRuntimeBounds.memoryCostKib,
  );
  const timeCost = integer(
    environment.ARGON2_TIME_COST,
    passwordRuntimeDefaults.timeCost,
    passwordRuntimeBounds.timeCost,
  );
  const parallelism = integer(
    environment.ARGON2_PARALLELISM,
    passwordRuntimeDefaults.parallelism,
    passwordRuntimeBounds.parallelism,
  );
  return {
    memoryCostKib,
    timeCost,
    parallelism,
    hashLength: passwordRuntimeDefaults.hashLength,
  };
}

function integer(
  value: unknown,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < bounds.min ||
    parsed > bounds.max
  ) {
    throw new TypeError('Invalid Argon2 runtime parameter');
  }
  return parsed;
}
