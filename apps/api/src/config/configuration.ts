import { envSchema } from './env.schema';

export const configuration = () => {
  const environment = envSchema.parse(process.env);

  return {
    app: {
      environment: environment.NODE_ENV,
      port: environment.PORT,
      webUrl: environment.WEB_URL,
    },
    database: {
      url: environment.DATABASE_URL,
    },
    auth: {
      jwtAccessSecret: environment.JWT_ACCESS_SECRET,
      jwtRefreshSecret: environment.JWT_REFRESH_SECRET,
    },
  };
};
