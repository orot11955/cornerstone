export type PublicConfigValue = string | number | boolean

export type PublicConfig = Readonly<Record<string, PublicConfigValue>>

export function definePublicConfig<const T extends PublicConfig>(config: T): T {
  return Object.freeze({ ...config })
}
