# Cornerstone — TypeScript Fullstack Starter 최종 구축 가이드

> 실행 순서, 선행 의사결정, 단계별 완료 조건과 검증 기준은
> [`cornerstone_implementation_plan.md`](./cornerstone_implementation_plan.md)를 따른다.

## 0. Cornerstone의 목적

Cornerstone은 특정 서비스 하나를 위한 Boilerplate가 아니다.

목표는:

> **새 프로젝트를 시작할 때 반복적으로 만드는 Fullstack 기반, 인증, DB, UI, 디자인 시스템, 테스트, 배포 기반을 미리 구축한 재사용 가능한 Project Foundation**

이다.

Cornerstone 자체에는 특정 프로젝트 Domain을 넣지 않는다.

포함:

```text
User
Auth
Permission

Database
Migration

API
Validation
Error
Logger

UI
Form
Table
Layout

Theme
Style
Brand
Density

Test
Docker
CI
```

제외:

```text
Project
Server
Deployment
Post
Blog
Calendar
Photo
Schedule
```

같은 실제 서비스 Domain.

---

# 1. 최종 기술 스택

```text
Monorepo
├── pnpm Workspace
└── Turborepo

Frontend
├── Next.js
├── TypeScript
├── Tailwind CSS
├── shadcn/ui
├── TanStack Query
├── React Hook Form
└── Zod

Backend
├── NestJS
├── TypeScript
├── TypeORM
├── PostgreSQL
├── @nestjs/config
├── class-validator
├── JWT
├── Passport
└── Argon2

Infrastructure
├── Docker Compose
├── PostgreSQL
└── Redis                 Optional

Testing
├── Unit
├── Integration
├── Vitest
└── Playwright E2E

Documentation
├── Swagger / OpenAPI
└── Project Docs
```

---

# 2. 최종 구조

```text
cornerstone/
│
├── apps/
│   │
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (public)/
│   │       │   └── (app)/
│   │       │
│   │       ├── components/
│   │       │   ├── common/
│   │       │   └── layout/
│   │       │
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   └── users/
│   │       │
│   │       ├── hooks/
│   │       ├── lib/
│   │       ├── providers/
│   │       └── styles/
│   │
│   └── api/
│       └── src/
│           ├── common/
│           │   ├── decorators/
│           │   ├── entities/
│           │   ├── errors/
│           │   ├── filters/
│           │   ├── guards/
│           │   ├── interceptors/
│           │   ├── middleware/
│           │   └── pipes/
│           │
│           ├── config/
│           │
│           ├── database/
│           │   ├── migrations/
│           │   ├── seeds/
│           │   └── data-source.ts
│           │
│           └── modules/
│               ├── auth/
│               └── users/
│
├── packages/
│   ├── api-client/
│   ├── config/
│   ├── schemas/
│   ├── types/
│   ├── ui/
│   ├── utils/
│   ├── tsconfig/
│   └── eslint-config/
│
├── infra/
│   └── compose/
│       └── compose.dev.yml
│
├── e2e/
├── docs/
├── scripts/
│
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── .editorconfig
├── .prettierrc
└── README.md
```

---

# 3. 전체 구축 순서

앞으로 아래 순서를 그대로 따른다.

```text
01 개발환경
02 Repository
03 pnpm Workspace
04 Next.js
05 NestJS
06 Web/API 실행
07 Turborepo
08 TypeScript
09 Formatter / Linter
10 Shared Packages
11 Environment Config

12 Docker
13 PostgreSQL
14 TypeORM
15 DataSource
16 Base Entity
17 User Entity
18 AuthSession Entity
19 Repository
20 Migration
21 Seed
22 DB 검증

23 Backend Bootstrap
24 Error
25 Logger
26 Request Context
27 Swagger
28 User Service

29 Auth
30 Refresh Rotation
31 Authorization
32 Rate Limit
33 Transaction

34 API Client
35 TanStack Query
36 React Hook Form
37 Frontend Auth

38 UI Package
39 Foundations
40 Theme
41 Brand
42 Style
43 Density
44 Semantic Token
45 Component Token
46 Appearance Provider
47 Primitive UI
48 Composite UI
49 Layout
50 DataTable

51 Health Check
52 Unit Test
53 DB Integration Test
54 Frontend Test
55 Playwright
56 Storybook

57 CI
58 Production Migration
59 Production Docker
60 Documentation
61 Starter v1
```

---

# Phase 1. 프로젝트 기반

# 4. 개발환경 확인

```bash
node -v
pnpm -v
git --version
docker --version
docker compose version
```

pnpm이 없다면:

```bash
npm install -g pnpm
```

### 완료 조건

- [ ] Node
- [ ] pnpm
- [ ] Git
- [ ] Docker
- [ ] Docker Compose

---

# 5. Repository 생성

```bash
mkdir cornerstone
cd cornerstone

git init
pnpm init
```

폴더 생성:

```bash
mkdir -p apps
mkdir -p packages
mkdir -p infra/compose
mkdir -p docs
mkdir -p scripts
mkdir -p e2e
```

---

# 6. pnpm Workspace

```bash
touch pnpm-workspace.yaml
```

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

---

# 7. Root Package

```bash
pnpm add -Dw turbo typescript prettier
```

`package.json`

```json
{
  "name": "cornerstone",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",

    "format": "prettier --write .",
    "format:check": "prettier --check ."
  }
}
```

---

# 8. Next.js 생성

```bash
pnpm create next-app@latest apps/web \
  --ts \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --turbopack \
  --import-alias "@/*" \
  --use-pnpm
```

권장:

- [ ] TypeScript
- [ ] Tailwind
- [ ] ESLint
- [ ] App Router
- [ ] `src`
- [ ] Turbopack
- [ ] `@/*`

실행:

```bash
pnpm --filter web dev
```

확인:

```text
http://localhost:3000
```

---

# 9. NestJS 생성

```bash
cd apps

pnpm dlx @nestjs/cli@latest new api \
  --package-manager pnpm \
  --strict \
  --skip-git

cd ..
```

실행:

```bash
pnpm --filter api start:dev
```

---

# 10. API Port

`apps/api/src/main.ts`

```ts
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  await app.listen(Number(process.env.PORT ?? 4000))
}

void bootstrap()
```

확인:

```bash
curl http://localhost:4000
```

기본:

```text
Web : 3000
API : 4000
```

---

# 11. Turborepo

API:

```json
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "typecheck": "tsc --noEmit"
  }
}
```

Web:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Root:

```bash
touch turbo.json
```

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },

    "build": {
      "dependsOn": ["^build"],
      "outputs": [
        ".next/**",
        "!.next/cache/**",
        "dist/**"
      ]
    },

    "lint": {
      "dependsOn": ["^lint"]
    },

    "typecheck": {
      "dependsOn": ["^typecheck"]
    },

    "test": {
      "dependsOn": ["^test"],
      "outputs": ["coverage/**"]
    }
  }
}
```

실행:

```bash
pnpm dev
```

### 완료

- [ ] Web 실행
- [ ] API 실행
- [ ] Root에서 `pnpm dev`
- [ ] 둘이 동시에 실행

---

# 12. 첫 Commit

```bash
git add .
git commit -m "chore: initialize cornerstone workspace"
```

여기는 반드시 보존한다.

```text
Next
+
Nest
+
pnpm
+
Turbo
```

만 존재하는 최소 정상 상태다.

---

# Phase 2. 코드 규칙

# 13. 공통 TypeScript Config

```bash
mkdir -p packages/tsconfig
```

```text
packages/tsconfig/
├── package.json
├── base.json
├── node.json
└── react.json
```

`base.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Backend에서는 확인:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

# 14. Formatter

```bash
touch .prettierrc
touch .prettierignore
touch .editorconfig
```

`.prettierrc`

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

`.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

---

# 15. Shared Packages

```bash
mkdir -p packages/types/src
mkdir -p packages/schemas/src
mkdir -p packages/utils/src
mkdir -p packages/config/src
mkdir -p packages/api-client/src
mkdir -p packages/ui/src
mkdir -p packages/eslint-config
```

각 패키지에 `package.json`을 만든다.

예:

```json
{
  "name": "@cornerstone/types",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Naming:

```text
@cornerstone/types
@cornerstone/schemas
@cornerstone/utils
@cornerstone/config
@cornerstone/api-client
@cornerstone/ui
@cornerstone/tsconfig
@cornerstone/eslint-config
```

---

# 16. 공통 Type

`packages/types/src/index.ts`

```ts
export type Nullable<T> = T | null

export type Optional<T> = T | undefined

export type SortDirection = 'asc' | 'desc'

export interface PageRequest {
  page: number
  size: number
}

export interface PageResponse<T> {
  items: T[]

  page: number
  size: number

  total: number
  totalPages: number
}
```

### 금지

공통 package를 Domain 쓰레기통으로 만들지 않는다.

```text
Project
Deployment
Server
Post
```

등은 넣지 않는다.

---

# 17. Shared Schema

```bash
pnpm --filter @cornerstone/schemas add zod
```

예:

```ts
import { z } from 'zod'

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  size: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
})
```

공유 대상:

```text
Email
URL
UUID
Pagination
Sort
DateRange
Common Filter
```

---

# 18. Backend Environment

```bash
pnpm --filter api add @nestjs/config zod
```

`apps/api/.env.example`

```env
NODE_ENV=development

PORT=4000
WEB_URL=http://localhost:3000

DATABASE_URL=postgresql://app:app@localhost:5432/app

JWT_ACCESS_SECRET=change-this-at-least-32-characters
JWT_REFRESH_SECRET=change-this-at-least-32-characters
```

구조:

```text
config/
├── env.schema.ts
└── configuration.ts
```

Schema:

```ts
import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().default(4000),

  WEB_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),

  JWT_REFRESH_SECRET: z.string().min(32),
})
```

### 규칙

애플리케이션 코드 곳곳에서:

```ts
process.env.JWT_ACCESS_SECRET
```

를 직접 읽지 않는다.

Config 계층을 통해 접근한다.

---

# Phase 3. Database / TypeORM

# 19. PostgreSQL Docker

`infra/compose/compose.dev.yml`

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped

    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app

    ports:
      - "5432:5432"

    volumes:
      - postgres-data:/var/lib/postgresql/data

    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped

    ports:
      - "6379:6379"

    volumes:
      - redis-data:/data

volumes:
  postgres-data:
  redis-data:
```

실행:

```bash
docker compose \
  -f infra/compose/compose.dev.yml \
  up -d
```

확인:

```bash
docker compose \
  -f infra/compose/compose.dev.yml \
  ps
```

---

# 20. TypeORM 설치

```bash
pnpm --filter api add \
  @nestjs/typeorm \
  typeorm \
  pg \
  reflect-metadata
```

Migration:

```bash
pnpm --filter api add -D ts-node
```

---

# 21. DB 디렉터리

```bash
mkdir -p apps/api/src/database/migrations
mkdir -p apps/api/src/database/seeds
mkdir -p apps/api/src/common/entities
```

```text
database/
├── data-source.ts
├── migrations/
└── seeds/
```

---

# 22. Nest TypeORM 연결

```ts
TypeOrmModule.forRootAsync({
  inject: [ConfigService],

  useFactory: (config: ConfigService) => ({
    type: 'postgres',

    url: config.getOrThrow<string>('DATABASE_URL'),

    autoLoadEntities: true,

    synchronize: false,

    migrationsRun: false,

    logging:
      config.get<string>('NODE_ENV') ===
      'development',
  }),
})
```

## 절대 규칙

```text
synchronize: false
```

모든 환경에서 유지한다.

금지:

```ts
synchronize:
  process.env.NODE_ENV !== 'production'
```

Cornerstone은 처음부터 Migration 중심으로 운용한다.

---

# 23. Migration DataSource

`apps/api/src/database/data-source.ts`

```ts
import 'reflect-metadata'

import { resolve } from 'node:path'

import { config } from 'dotenv'
import { DataSource } from 'typeorm'

config({
  path: resolve(__dirname, '../../.env'),
})

const AppDataSource = new DataSource({
  type: 'postgres',

  url: process.env.DATABASE_URL,

  synchronize: false,

  entities: [
    resolve(__dirname, '../**/*.entity.{ts,js}'),
  ],

  migrations: [
    resolve(__dirname, './migrations/*.{ts,js}'),
  ],

  migrationsTableName: 'typeorm_migrations',
})

export default AppDataSource
```

---

# 24. CoreEntity

`common/entities/core.entity.ts`

```ts
import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export abstract class CoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  createdAt!: Date

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  updatedAt!: Date
}
```

Base에는 기본적으로:

```text
id
createdAt
updatedAt
```

만 둔다.

`deletedAt`은 필요한 Entity에만 둔다.

---

# 25. User Entity

```bash
mkdir -p apps/api/src/modules/users/entities
```

```ts
import {
  Column,
  Entity,
  Index,
  OneToMany,
} from 'typeorm'

import { CoreEntity } from '../../../common/entities/core.entity'
import { AuthSession } from '../../auth/entities/auth-session.entity'

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

@Entity({
  name: 'users',
})
export class User extends CoreEntity {
  @Index({
    unique: true,
  })
  @Column({
    length: 255,
  })
  email!: string

  @Column({
    name: 'password_hash',
    select: false,
  })
  passwordHash!: string

  @Column({
    length: 100,
    nullable: true,
  })
  name!: string | null

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role!: UserRole

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus

  @OneToMany(
    () => AuthSession,
    session => session.user,
  )
  sessions!: AuthSession[]
}
```

---

# 26. passwordHash

반드시:

```ts
select: false
```

일반 조회:

```ts
repository.find()
```

결과에 Hash를 포함시키지 않는다.

로그인 시에만:

```ts
const user =
  await this.usersRepository
    .createQueryBuilder('user')
    .addSelect('user.passwordHash')
    .where('user.email = :email', {
      email,
    })
    .getOne()
```

---

# 27. AuthSession Entity

```bash
mkdir -p apps/api/src/modules/auth/entities
```

```ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm'

import { CoreEntity } from '../../../common/entities/core.entity'
import { User } from '../../users/entities/user.entity'

@Entity({
  name: 'auth_sessions',
})
export class AuthSession extends CoreEntity {
  @Column({
    name: 'user_id',
    type: 'uuid',
  })
  userId!: string

  @ManyToOne(
    () => User,
    user => user.sessions,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'user_id',
  })
  user!: User

  @Index({
    unique: true,
  })
  @Column({
    name: 'token_hash',
  })
  tokenHash!: string

  @Column({
    name: 'expires_at',
    type: 'timestamptz',
  })
  expiresAt!: Date

  @Column({
    name: 'revoked_at',
    type: 'timestamptz',
    nullable: true,
  })
  revokedAt!: Date | null
}
```

---

# 28. Relation 규칙

기본적으로:

```ts
cascade: true
```

사용을 피한다.

명시적으로:

```text
User 저장
Session 저장
```

한다.

필요한 DB-level 행동만:

```text
onDelete
onUpdate
```

로 지정한다.

---

# 29. UsersModule

```bash
cd apps/api

pnpm exec nest g module modules/users
pnpm exec nest g service modules/users
pnpm exec nest g controller modules/users

cd ../..
```

Module:

```ts
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
    ]),
  ],

  providers: [
    UsersService,
  ],

  controllers: [
    UsersController,
  ],

  exports: [
    UsersService,
  ],
})
export class UsersModule {}
```

---

# 30. Repository Injection

```ts
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository:
      Repository<User>,
  ) {}
}
```

---

# 31. Repository 사용 규칙

간단한 Query:

```text
Repository
```

예:

```ts
find()
findOne()
findOneBy()
findAndCount()
existsBy()
count()
save()
update()
delete()
```

복잡한 Query:

```text
QueryBuilder
```

예:

```text
Join
Dynamic Filter
Aggregation
Subquery
복합 Sorting
복잡한 Pagination
Lock
```

---

# 32. Entity를 API Response로 사용하지 않는다

금지:

```text
Entity
=
API Contract
```

올바른 흐름:

```text
Database Entity
      ↓
Service
      ↓
Mapper
      ↓
Response DTO
      ↓
Controller
```

예:

```ts
export interface UserResponse {
  id: string

  email: string
  name: string | null

  role: UserRole
  status: UserStatus

  createdAt: Date
}
```

---

# 33. Migration Script

`apps/api/package.json`

```json
{
  "scripts": {
    "db:migration:create": "typeorm-ts-node-commonjs migration:create",

    "db:migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/database/data-source.ts",

    "db:migration:run": "typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts",

    "db:migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts",

    "db:migration:show": "typeorm-ts-node-commonjs migration:show -d src/database/data-source.ts"
  }
}
```

---

# 34. Migration 생성

```bash
pnpm --filter api \
  db:migration:generate -- \
  src/database/migrations/Init
```

검토:

- [ ] users
- [ ] auth_sessions
- [ ] FK
- [ ] Index
- [ ] Enum
- [ ] Nullable
- [ ] Column Type

---

# 35. Migration 실행

```bash
pnpm --filter api db:migration:run
```

확인:

```bash
pnpm --filter api db:migration:show
```

Rollback:

```bash
pnpm --filter api db:migration:revert
```

---

# 36. Migration 규칙

항상:

```text
Entity 수정
    ↓
Migration Generate
    ↓
Migration 코드 / SQL 확인
    ↓
Migration Run
    ↓
Service 수정
    ↓
Test
```

Naming:

```text
Init

CreateUser

AddUserStatus

CreateAuthSession

AddProjectOwner

AddDeployIndex
```

피함:

```text
Fix
Update
Change
Test
Migration1
```

---

# 37. Seed

`database/seeds/seed.ts`

```ts
import * as argon2 from 'argon2'

import AppDataSource from '../data-source'

import {
  User,
  UserRole,
  UserStatus,
} from '../../modules/users/entities/user.entity'

async function seed() {
  await AppDataSource.initialize()

  try {
    const repository =
      AppDataSource.getRepository(User)

    const email =
      'admin@example.com'

    const exists =
      await repository.findOne({
        where: {
          email,
        },
      })

    if (exists) {
      return
    }

    const passwordHash =
      await argon2.hash(
        'change-me',
      )

    await repository.save(
      repository.create({
        email,

        passwordHash,

        role: UserRole.ADMIN,

        status:
          UserStatus.ACTIVE,
      }),
    )
  } finally {
    await AppDataSource.destroy()
  }
}

void seed()
```

---

# 38. Seed Rule

Seed는 가능한 한:

```text
idempotent
```

하게 작성한다.

즉 여러 번 실행해도 같은 사용자가 계속 추가되지 않는다.

---

# 39. Root DB Command

Root `package.json`:

```json
{
  "scripts": {
    "db:migrate": "pnpm --filter api db:migration:run",

    "db:revert": "pnpm --filter api db:migration:revert",

    "db:status": "pnpm --filter api db:migration:show",

    "db:seed": "pnpm --filter api db:seed"
  }
}
```

앞으로 Root에서:

```bash
pnpm db:migrate

pnpm db:status

pnpm db:revert

pnpm db:seed
```

만 기억하면 된다.

---

# 40. DB 완료 Commit

```bash
git add .

git commit -m \
  "feat: add typeorm database foundation"
```

완료 조건:

- [ ] PostgreSQL
- [ ] TypeORM
- [ ] DataSource
- [ ] Entity
- [ ] Repository
- [ ] Migration
- [ ] Seed
- [ ] API 부팅

---

# Phase 4. Backend Foundation

# 41. Backend 구조

```text
apps/api/src/
│
├── modules/
│   ├── auth/
│   └── users/
│
├── common/
│   ├── decorators/
│   ├── entities/
│   ├── errors/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── middleware/
│   └── pipes/
│
├── config/
└── database/
```

Starter에서는 과도한 Clean Architecture를 강제하지 않는다.

기본:

```text
Controller
    ↓
Service
    ↓
Repository
```

---

# 42. Backend 기본 Package

```bash
pnpm --filter api add \
  helmet \
  cookie-parser \
  class-validator \
  class-transformer \
  @nestjs/throttler \
  @nestjs/swagger
```

```bash
pnpm --filter api add -D \
  @types/cookie-parser
```

---

# 43. main.ts Bootstrap

```ts
async function bootstrap() {
  const app =
    await NestFactory.create(
      AppModule,
    )

  app.setGlobalPrefix('api')

  app.enableCors({
    origin:
      process.env.WEB_URL,

    credentials: true,
  })

  app.use(
    helmet(),
  )

  app.use(
    cookieParser(),
  )

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,

      forbidNonWhitelisted:
        true,

      transform: true,
    }),
  )

  await app.listen(
    Number(
      process.env.PORT ??
        4000,
    ),
  )
}

void bootstrap()
```

---

# 44. API Error 표준

모든 Error Response:

```json
{
  "code": "USER_NOT_FOUND",
  "message": "사용자를 찾을 수 없습니다.",
  "details": null,
  "requestId": "019...",
  "timestamp": "2026-08-12T00:00:00.000Z"
}
```

Error Hierarchy:

```text
AppError
├── ValidationError
├── AuthenticationError
├── AuthorizationError
├── NotFoundError
├── ConflictError
└── BusinessError
```

Controller마다 `try/catch`를 반복하지 않는다.

Global Exception Filter가 처리한다.

---

# 45. PostgreSQL Error Mapping

예:

```text
Unique Constraint
↓
ConflictError

Foreign Key
↓
BusinessError

Not Null
↓
Validation / Internal Error
```

예:

```text
USER_EMAIL_ALREADY_EXISTS
```

DB Error 문자열을 Client에 그대로 노출하지 않는다.

---

# 46. Request Context

요청 동안 최소:

```text
requestId
userId
ip
userAgent
```

를 추적할 수 있게 한다.

Node에서는 필요하면:

```text
AsyncLocalStorage
```

기반 Request Context를 만든다.

---

# 47. Request ID

흐름:

```text
Request
↓
X-Request-ID
↓
Controller
↓
Service
↓
Repository
↓
Log
↓
Response
```

Client가 주지 않았다면 Server에서 생성한다.

---

# 48. Logger

금지:

```ts
console.log()
```

기본:

```text
Nest Logger
```

이후 필요하면:

```text
Pino
OpenTelemetry
Loki
```

로 확장한다.

Logging 항목:

```text
timestamp
level
requestId
userId
method
path
status
duration
```

---

# 49. Swagger

```ts
const config =
  new DocumentBuilder()
    .setTitle('Cornerstone API')
    .setVersion('1.0')
    .addBearerAuth()
    .build()

const document =
  SwaggerModule.createDocument(
    app,
    config,
  )

SwaggerModule.setup(
  'docs',
  app,
  document,
)
```

확인:

```text
http://localhost:4000/docs
```

---

# 50. Users Service

최소:

```text
findById
findByEmail
create
update
deactivate
```

---

# Phase 5. Auth / Security

# 51. Auth Package 설치

```bash
pnpm --filter api add \
  @nestjs/passport \
  passport \
  passport-jwt \
  @nestjs/jwt \
  argon2
```

```bash
pnpm --filter api add -D \
  @types/passport-jwt
```

---

# 52. Auth 구조

```text
modules/auth/
├── dto/
│   ├── login.dto.ts
│   └── register.dto.ts
│
├── entities/
│   └── auth-session.entity.ts
│
├── guards/
│   ├── access-token.guard.ts
│   └── roles.guard.ts
│
├── strategies/
│   └── jwt.strategy.ts
│
├── auth.controller.ts
├── auth.service.ts
└── auth.module.ts
```

---

# 53. Auth Endpoint

```text
POST /api/auth/register

POST /api/auth/login

POST /api/auth/refresh

POST /api/auth/logout

GET /api/auth/me
```

---

# 54. Password

저장:

```text
password
↓
Argon2
↓
passwordHash
```

절대 Raw Password를 저장하지 않는다.

---

# 55. Cookie Auth

브라우저 기반 Starter의 기본:

```text
HttpOnly Cookie
```

예:

```ts
res.cookie(
  'access_token',
  token,
  {
    httpOnly: true,

    secure:
      isProduction,

    sameSite: 'lax',
  },
)
```

금지:

```ts
localStorage.setItem(
  'access_token',
  token,
)
```

를 기본 인증 전략으로 사용하지 않는다.

---

# 56. Access / Refresh

```text
Access Token
→ 짧은 수명

Refresh Token
→ 긴 수명
```

Refresh Token은 Session Entity와 연결한다.

---

# 57. Refresh Rotation

```text
Login
↓
Refresh #1
↓
Hash DB 저장

Refresh 요청
↓
#1 검증
↓
#1 revoke
↓
Refresh #2
↓
#2 hash 저장
```

DB에는 Raw Refresh Token을 저장하지 않는다.

```text
Raw Token
↓
Hash
↓
DB
```

---

# 58. Register Transaction

```text
Email 확인
↓
Password Hash
↓
User INSERT
↓
Session INSERT
↓
Token 반환
```

여러 Write가 하나의 동작이면 Transaction을 고려한다.

---

# 59. TypeORM Transaction

기본:

```ts
await this.dataSource.transaction(
  async manager => {
    const users =
      manager.getRepository(User)

    const sessions =
      manager.getRepository(
        AuthSession,
      )

    // transaction work
  },
)
```

### 절대 규칙

Transaction 안에서는 일반 Repository가 아니라:

```text
manager.getRepository()
```

를 사용한다.

---

# 60. QueryRunner

정밀한 제어가 필요할 때만:

```ts
const queryRunner =
  this.dataSource
    .createQueryRunner()

await queryRunner.connect()

await queryRunner.startTransaction()

try {
  // work

  await queryRunner.commitTransaction()
} catch (error) {
  await queryRunner.rollbackTransaction()

  throw error
} finally {
  await queryRunner.release()
}
```

기본은:

```text
DataSource.transaction()
```

이다.

---

# 61. Authorization

Authentication:

```text
누구인가?
```

Authorization:

```text
무엇을 할 수 있는가?
```

별도로 관리한다.

처음에는 RBAC:

```text
USER
ADMIN
```

예:

```ts
@Roles(UserRole.ADMIN)
```

이후:

```text
project.read
project.write
project.deploy
user.manage
```

Permission 모델로 확장 가능.

---

# 62. Rate Limiting

특히:

```text
/auth/login
/auth/register
/auth/refresh
/password/reset
/email/verify
```

에 적용한다.

---

# 63. Auth 완료 체크

- [ ] Register
- [ ] Login
- [ ] 잘못된 Password
- [ ] Me
- [ ] Refresh
- [ ] Token Rotation
- [ ] Logout
- [ ] Logout 후 Refresh 실패
- [ ] User Guard
- [ ] Admin Guard
- [ ] Email Unique
- [ ] Transaction Rollback

Commit:

```bash
git add .

git commit -m \
  "feat: add authentication foundation"
```

---

# Phase 6. Frontend Data Layer

# 64. API Client

```text
packages/api-client/
└── src/
    ├── client.ts
    ├── error.ts
    └── index.ts
```

기본:

```ts
export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response =
    await fetch(path, {
      ...options,

      credentials: 'include',

      headers: {
        'Content-Type':
          'application/json',

        ...options?.headers,
      },
    })

  if (!response.ok) {
    throw await response.json()
  }

  return response.json()
}
```

공통 처리:

- [ ] Base URL
- [ ] JSON
- [ ] Cookie
- [ ] Error Mapping
- [ ] AbortSignal
- [ ] Timeout
- [ ] Request ID

---

# 65. TanStack Query

```bash
pnpm --filter web add \
  @tanstack/react-query \
  @tanstack/react-query-devtools
```

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,

      retry: 1,

      refetchOnWindowFocus: false,
    },
  },
})
```

Query Key도 규칙화한다.

```ts
userKeys.all

userKeys.list(params)

userKeys.detail(id)
```

---

# 66. React Hook Form

```bash
pnpm --filter web add \
  react-hook-form \
  @hookform/resolvers \
  zod
```

흐름:

```text
Zod
↓
React Hook Form
↓
Mutation
↓
API Client
```

---

# 67. Frontend 구조

```text
apps/web/src/
├── app/
│   ├── (public)/
│   └── (app)/
│
├── components/
│   ├── common/
│   └── layout/
│
├── features/
│   ├── auth/
│   └── users/
│
├── hooks/
├── lib/
├── providers/
└── styles/
```

---

# 68. Frontend Auth

```text
features/auth/
├── api/
├── components/
├── hooks/
└── schemas/
```

Auth State:

```ts
type AuthState =
  | 'loading'
  | 'anonymous'
  | 'authenticated'
```

Source of Truth:

```text
GET /api/auth/me
```

Frontend state의:

```text
isLoggedIn = true
```

만으로 인증 여부를 결정하지 않는다.

---

# Phase 7. Cornerstone Design System

# 69. 핵심 개념

Cornerstone 디자인은 단일 Theme가 아니다.

```text
Appearance
=
Theme
×
Style
×
Brand
×
Density
```

각 축을 완전히 분리한다.

예:

```text
ATLAS

Theme   : dark
Style   : industrial
Brand   : signal-violet
Density : default
```

다른 프로젝트:

```text
Theme   : light
Style   : minimal
Brand   : emerald
Density : comfortable
```

---

# 70. DOM Appearance

```html
<html
  data-theme="dark"
  data-style="industrial"
  data-brand="signal-violet"
  data-density="default"
>
```

---

# 71. Cornerstone 디자인 구조

```text
Cornerstone
│
├── Foundations
│   ├── Primitive
│   ├── Typography
│   ├── Spacing
│   ├── Radius
│   ├── Shadow
│   ├── Motion
│   ├── Breakpoint
│   └── Z-Index
│
├── Appearance
│   │
│   ├── Theme
│   │   ├── Light
│   │   └── Dark
│   │
│   ├── Style
│   │   ├── Industrial
│   │   ├── Minimal
│   │   └── Soft
│   │
│   ├── Brand
│   │   ├── Signal Violet
│   │   ├── Orange
│   │   ├── Emerald
│   │   └── Custom
│   │
│   └── Density
│       ├── Compact
│       ├── Default
│       └── Comfortable
│
├── Semantic Tokens
│
├── Component Tokens
│
├── Components
│
└── Domain
    └── 프로젝트별 확장
```

---

# 72. Token Dependency

반드시:

```text
Foundation
    ↓
Appearance
    ↓
Semantic
    ↓
Component Token
    ↓
Component
    ↓
Domain
```

방향을 유지한다.

금지:

```text
Button
↓
Primitive Violet
```

금지:

```text
Table
↓
Dark Theme
```

금지:

```text
Input
↓
Industrial
```

---

# 73. UI Package 구조

```text
packages/ui/
└── src/
    │
    ├── styles/
    │   │
    │   ├── foundations/
    │   │   ├── primitive.css
    │   │   ├── typography.css
    │   │   ├── spacing.css
    │   │   ├── radius.css
    │   │   ├── shadow.css
    │   │   ├── motion.css
    │   │   ├── breakpoint.css
    │   │   └── z-index.css
    │   │
    │   ├── appearance/
    │   │   │
    │   │   ├── theme/
    │   │   │   ├── light.css
    │   │   │   └── dark.css
    │   │   │
    │   │   ├── style/
    │   │   │   ├── industrial.css
    │   │   │   ├── minimal.css
    │   │   │   └── soft.css
    │   │   │
    │   │   ├── brand/
    │   │   │   ├── signal-violet.css
    │   │   │   ├── orange.css
    │   │   │   ├── emerald.css
    │   │   │   └── custom.css
    │   │   │
    │   │   └── density/
    │   │       ├── compact.css
    │   │       ├── default.css
    │   │       └── comfortable.css
    │   │
    │   ├── tokens/
    │   │   ├── semantic.css
    │   │   └── components/
    │   │       ├── button.css
    │   │       ├── input.css
    │   │       ├── select.css
    │   │       ├── card.css
    │   │       └── table.css
    │   │
    │   └── index.css
    │
    ├── components/
    │   ├── button/
    │   ├── input/
    │   ├── select/
    │   ├── dialog/
    │   └── ...
    │
    └── index.ts
```

---

# 74. Primitive Color

```css
:root {
  --primitive-white: #ffffff;
  --primitive-black: #000000;

  --primitive-gray-50: ...;
  --primitive-gray-100: ...;
  --primitive-gray-200: ...;
  --primitive-gray-300: ...;
  --primitive-gray-400: ...;
  --primitive-gray-500: ...;
  --primitive-gray-600: ...;
  --primitive-gray-700: ...;
  --primitive-gray-800: ...;
  --primitive-gray-900: ...;
  --primitive-gray-950: ...;

  --primitive-violet-50: ...;
  --primitive-violet-100: ...;
  --primitive-violet-200: ...;
  --primitive-violet-300: ...;
  --primitive-violet-400: ...;
  --primitive-violet-500: ...;
  --primitive-violet-600: ...;
  --primitive-violet-700: ...;
  --primitive-violet-800: ...;
  --primitive-violet-900: ...;
}
```

Primitive에는 의미를 넣지 않는다.

좋음:

```text
--primitive-violet-500
```

피함:

```text
--primitive-primary
```

---

# 75. Typography

```css
:root {
  --font-sans: ...;
  --font-mono: ...;

  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.7;
}
```

숫자가 많은 UI에는:

```css
font-variant-numeric:
  tabular-nums;
```

도 고려한다.

---

# 76. Spacing

```css
:root {
  --space-0: 0;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
}
```

Primitive spacing 자체는 Density에 따라 변경하지 않는다.

---

# 77. Radius

```css
:root {
  --radius-none: 0;
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

---

# 78. Motion

```css
:root {
  --duration-fast: 100ms;
  --duration-normal: 160ms;
  --duration-slow: 240ms;

  --ease-standard: ...;
  --ease-enter: ...;
  --ease-exit: ...;
}
```

`prefers-reduced-motion`도 고려한다.

---

# 79. Theme

Theme는:

```text
Light
Dark
```

만 담당한다.

주 책임:

```text
Background
Surface
Text
Border
Contrast
```

Light:

```css
[data-theme='light'] {
  --surface-base:
    var(--primitive-white);

  --surface-subtle:
    var(--primitive-gray-50);

  --surface-raised:
    var(--primitive-white);

  --text-base:
    var(--primitive-gray-950);

  --text-muted:
    var(--primitive-gray-600);

  --border-base:
    var(--primitive-gray-200);

  --border-strong:
    var(--primitive-gray-300);
}
```

Dark:

```css
[data-theme='dark'] {
  --surface-base:
    var(--primitive-gray-950);

  --surface-subtle:
    var(--primitive-gray-900);

  --text-base:
    var(--primitive-gray-50);

  --text-muted:
    var(--primitive-gray-400);

  --border-base:
    var(--primitive-gray-800);

  --border-strong:
    var(--primitive-gray-700);
}
```

Theme에는:

```text
Industrial
Violet
Compact
```

같은 개념을 넣지 않는다.

---

# 80. Brand

Brand는 색 Identity만 담당한다.

예:

```text
signal-violet
orange
emerald
custom
```

Signal Violet:

```css
[data-brand='signal-violet'] {
  --brand-50:
    var(--primitive-violet-50);

  --brand-100:
    var(--primitive-violet-100);

  --brand-500:
    var(--primitive-violet-500);

  --brand-600:
    var(--primitive-violet-600);

  --brand-700:
    var(--primitive-violet-700);
}
```

Component는:

```text
--brand-500
```

조차 직접 사용하기보다 Semantic을 사용한다.

---

# 81. Brand와 Status 분리

중요:

```text
Brand
≠
Status
```

Brand가 Violet이라고:

```text
Success = Violet
```

이 되는 구조는 피한다.

Status:

```text
Success
Warning
Danger
Info
```

는 별도의 Semantic 의미를 가진다.

---

# 82. Style

Style은 형태적 특성을 담당한다.

```text
Industrial
Minimal
Soft
```

Style이 결정할 수 있는 것:

```text
Radius
Border
Shadow
Visual hierarchy
Surface treatment
Control shape
Motion character
```

Industrial:

```css
[data-style='industrial'] {
  --control-radius:
    var(--radius-xs);

  --panel-radius:
    var(--radius-sm);

  --border-width-default: 1px;

  --surface-shadow: none;

  --motion-interaction-duration:
    var(--duration-fast);
}
```

Minimal:

```css
[data-style='minimal'] {
  --control-radius:
    var(--radius-md);

  --panel-radius:
    var(--radius-lg);

  --surface-shadow:
    var(--shadow-sm);
}
```

Soft:

```css
[data-style='soft'] {
  --control-radius:
    var(--radius-lg);

  --panel-radius:
    var(--radius-xl);

  --surface-shadow:
    var(--shadow-md);
}
```

---

# 83. Density

Density:

```text
Compact
Default
Comfortable
```

담당:

```text
Control Height
Padding
Gap
Table Row
Toolbar
Information Density
```

Compact:

```css
[data-density='compact'] {
  --control-height-sm: 24px;
  --control-height-md: 30px;
  --control-height-lg: 36px;

  --control-padding-x:
    var(--space-2);

  --table-row-height: 32px;

  --layout-gap:
    var(--space-2);
}
```

Default:

```css
[data-density='default'] {
  --control-height-sm: 28px;
  --control-height-md: 36px;
  --control-height-lg: 44px;

  --control-padding-x:
    var(--space-3);

  --table-row-height: 40px;

  --layout-gap:
    var(--space-3);
}
```

Comfortable:

```css
[data-density='comfortable'] {
  --control-height-sm: 32px;
  --control-height-md: 40px;
  --control-height-lg: 48px;

  --control-padding-x:
    var(--space-4);

  --table-row-height: 48px;

  --layout-gap:
    var(--space-4);
}
```

---

# 84. Semantic Token

가장 중요한 계층이다.

```css
:root {
  --color-bg:
    var(--surface-base);

  --color-bg-subtle:
    var(--surface-subtle);

  --color-bg-raised:
    var(--surface-raised);

  --color-text:
    var(--text-base);

  --color-text-muted:
    var(--text-muted);

  --color-border:
    var(--border-base);

  --color-border-strong:
    var(--border-strong);

  --color-primary:
    var(--brand-500);

  --color-primary-hover:
    var(--brand-600);

  --color-primary-active:
    var(--brand-700);

  --color-focus:
    var(--brand-500);
}
```

Component는 가능하면 이 계층부터 사용한다.

---

# 85. Status Semantic Token

```css
:root {
  --color-success: ...;
  --color-success-bg: ...;
  --color-success-border: ...;

  --color-warning: ...;
  --color-warning-bg: ...;
  --color-warning-border: ...;

  --color-danger: ...;
  --color-danger-bg: ...;
  --color-danger-border: ...;

  --color-info: ...;
  --color-info-bg: ...;
  --color-info-border: ...;
}
```

---

# 86. Component Token

```text
tokens/components/
├── button.css
├── input.css
├── select.css
├── card.css
├── table.css
└── dialog.css
```

예:

```css
:root {
  --button-height:
    var(--control-height-md);

  --button-radius:
    var(--control-radius);

  --button-padding-x:
    var(--control-padding-x);

  --button-primary-bg:
    var(--color-primary);

  --button-primary-bg-hover:
    var(--color-primary-hover);
}
```

---

# 87. Button 구현

```css
.button {
  height:
    var(--button-height);

  padding-inline:
    var(--button-padding-x);

  border-radius:
    var(--button-radius);
}

.button[data-variant='primary'] {
  background:
    var(--button-primary-bg);
}
```

Button 내부에서 금지:

```css
#7c3aed
```

금지:

```css
[data-theme='dark']
```

금지:

```css
[data-brand='signal-violet']
```

Component는 Appearance 조합을 몰라야 한다.

---

# 88. Appearance Type

```ts
export type Theme =
  | 'light'
  | 'dark'

export type ThemePreference =
  | Theme
  | 'system'

export type Style =
  | 'industrial'
  | 'minimal'
  | 'soft'

export type Brand =
  | 'signal-violet'
  | 'orange'
  | 'emerald'
  | 'custom'

export type Density =
  | 'compact'
  | 'default'
  | 'comfortable'

export interface Appearance {
  theme: ThemePreference

  style: Style

  brand: Brand

  density: Density
}
```

---

# 89. Cornerstone 기본 Appearance

```ts
export const defaultAppearance = {
  theme: 'system',

  style: 'minimal',

  brand: 'signal-violet',

  density: 'default',
} as const
```

`system`은 실제 CSS Theme가 아니다.

System 상태를 계산해 최종 DOM에는:

```text
light
```

또는:

```text
dark
```

가 들어간다.

---

# 90. AppearanceProvider

```tsx
<AppearanceProvider
  defaultStyle="industrial"
  defaultBrand="signal-violet"
  defaultDensity="default"
>
  {children}
</AppearanceProvider>
```

내부:

```ts
document.documentElement.dataset.theme =
  resolvedTheme

document.documentElement.dataset.style =
  style

document.documentElement.dataset.brand =
  brand

document.documentElement.dataset.density =
  density
```

---

# 91. useAppearance

```ts
const {
  theme,
  setTheme,

  style,
  setStyle,

  brand,
  setBrand,

  density,
  setDensity,
} = useAppearance()
```

저장:

```text
localStorage
```

사용 가능.

단 Theme는 SSR hydration 시 Flash가 발생하지 않도록 초기 적용 전략을 별도로 고려한다.

---

# 92. 프로젝트별 Appearance

Cornerstone을 수정하지 않는다.

프로젝트에서:

```ts
export const projectAppearance = {
  style: 'industrial',

  brand: 'signal-violet',

  density: 'default',
} as const
```

ATLAS:

```text
Theme   dark
Style   industrial
Brand   signal-violet
Density default
```

다른 프로젝트:

```text
Theme   light
Style   minimal
Brand   emerald
Density comfortable
```

---

# 93. Custom Brand

프로젝트에서:

```text
apps/web/src/styles/brand.css
```

```css
[data-brand='custom'] {
  --brand-50: ...;
  --brand-100: ...;
  --brand-200: ...;
  --brand-500: ...;
  --brand-600: ...;
  --brand-700: ...;
}
```

Cornerstone:

```text
Brand Contract 제공
```

Project:

```text
실제 Custom Brand 구현
```

으로 나눈다.

---

# 94. Component Variant는 별개

Appearance:

```text
Theme
Style
Brand
Density
```

와:

```text
Button Variant
```

는 다른 개념이다.

예:

```tsx
<Button variant="primary" />

<Button variant="secondary" />

<Button variant="outline" />

<Button variant="ghost" />

<Button variant="destructive" />
```

`variant`는 Component의 용도다.

---

# Phase 8. UI Component

# 95. shadcn 초기화

UI package를 먼저 준비한 뒤 shadcn을 연결한다.

구조가 만들어진 상태에서 Monorepo 설정을 확인하고 초기화한다.

```bash
cd apps/web

pnpm dlx shadcn@latest init
```

추가되는 파일 위치와 import alias가:

```text
packages/ui
```

구조에 맞도록 `components.json`을 조정한다.

---

# 96. Primitive Components

먼저:

- [ ] Button
- [ ] Input
- [ ] Label
- [ ] Textarea
- [ ] Select
- [ ] Checkbox
- [ ] Radio
- [ ] Switch
- [ ] Dialog
- [ ] Dropdown
- [ ] Tooltip
- [ ] Badge
- [ ] Skeleton
- [ ] Toast
- [ ] Tabs

---

# 97. Composite Components

그 다음:

- [ ] TextField
- [ ] PasswordField
- [ ] NumberField
- [ ] SelectField
- [ ] SearchInput
- [ ] ConfirmDialog
- [ ] LoadingOverlay

---

# 98. State Components

- [ ] LoadingState
- [ ] EmptyState
- [ ] ErrorState
- [ ] ForbiddenState
- [ ] NotFoundState

---

# 99. Layout Components

- [ ] Container
- [ ] Stack
- [ ] HStack
- [ ] VStack
- [ ] Grid
- [ ] Page
- [ ] PageHeader
- [ ] PageBody
- [ ] Sidebar
- [ ] Header
- [ ] Panel
- [ ] Card
- [ ] Section

예:

```tsx
<Page>
  <PageHeader
    title="사용자"
  />

  <PageBody>
    ...
  </PageBody>
</Page>
```

---

# 100. Component Layer

```text
Primitive
↓
Composite
↓
Domain
```

Primitive:

```text
Button
Input
Select
Dialog
```

Composite:

```text
TextField
SearchInput
ConfirmDialog
DataTable
```

Domain:

```text
ServerCard
ProjectStatus
DeployDialog
```

Domain은:

```text
packages/ui
```

에 넣지 않는다.

---

# 101. Confirm API

이상적인 사용:

```ts
const confirmed =
  await confirm({
    title:
      '삭제하시겠습니까?',

    description:
      '이 작업은 되돌릴 수 없습니다.',
  })

if (!confirmed) {
  return
}
```

페이지마다 Dialog 상태 코드를 반복하지 않는다.

---

# 102. DataTable

실제 CRUD 화면 2~3개를 먼저 만든 뒤 추출한다.

v1:

- [ ] Column
- [ ] Sorting
- [ ] Filtering
- [ ] Pagination
- [ ] Selection
- [ ] Loading
- [ ] Empty
- [ ] Error

v2:

- [ ] Resizing
- [ ] Pinning
- [ ] Visibility
- [ ] Bulk Action
- [ ] Inline Editing
- [ ] Export

---

# 103. Pagination 규격

Request:

```text
?page=1
&size=20
&sort=createdAt
&direction=desc
```

Response:

```json
{
  "items": [],
  "page": 1,
  "size": 20,
  "total": 100,
  "totalPages": 5
}
```

---

# 104. Search / Filter

기본:

```text
page
size
sort
direction
keyword
```

도메인별:

```text
status
createdFrom
createdTo
```

추가.

Frontend URL과 Backend DTO를 가능한 일관되게 만든다.

---

# Phase 9. Health / Testing

# 105. Health Check

```bash
pnpm --filter api add \
  @nestjs/terminus
```

Endpoint:

```text
GET /api/health/live

GET /api/health/ready
```

Live:

```text
Process 살아 있음
```

Ready:

```text
PostgreSQL
Redis
Required External API
```

---

# 106. TypeORM Unit Test

Repository Mock:

```ts
{
  provide:
    getRepositoryToken(User),

  useValue: {
    findOne:
      vi.fn(),

    findOneBy:
      vi.fn(),

    create:
      vi.fn(),

    save:
      vi.fn(),

    update:
      vi.fn(),

    delete:
      vi.fn(),
  },
}
```

---

# 107. Backend Unit 대상

```text
UsersService
AuthService
Permission
Mapper
Error Mapping
```

특히:

- [ ] User 없음
- [ ] Email 중복
- [ ] Password 실패
- [ ] Session 실패
- [ ] Refresh 재사용
- [ ] Transaction rollback

---

# 108. DB Integration Test

`.env.test`

```env
DATABASE_URL=postgresql://app:app@localhost:5432/app_test
```

흐름:

```text
Test DB
↓
Migration
↓
Test
↓
Cleanup
```

Production DB 사용 금지.

---

# 109. DB Integration 대상

- [ ] Entity Mapping
- [ ] Relation
- [ ] Unique
- [ ] Foreign Key
- [ ] Index
- [ ] QueryBuilder
- [ ] Transaction
- [ ] Pagination
- [ ] Migration

---

# 110. Frontend Test

```bash
pnpm --filter web add -D \
  vitest \
  jsdom \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event
```

대상:

```text
LoginForm
Validation
API Error
Query
Button
Dialog
AppearanceProvider
Theme Change
Brand Change
Density Change
```

---

# 111. Playwright

```bash
pnpm create playwright
```

테스트:

- [ ] Register
- [ ] Login
- [ ] Protected Route
- [ ] Logout
- [ ] Admin Guard
- [ ] CRUD
- [ ] Pagination
- [ ] Theme 변경
- [ ] Appearance 저장

---

# 112. Storybook

UI가 어느 정도 안정된 후 추가한다.

```bash
cd apps/web

pnpm create storybook@latest
```

Story 대상:

```text
Button
Input
Select
Dialog
Toast
Badge
Status
FormField
Card
Table
EmptyState
```

그리고 Appearance 조합:

```text
Light / Industrial / Violet

Dark / Industrial / Violet

Light / Minimal / Emerald

Dark / Soft / Orange

Compact

Default

Comfortable
```

를 시각 검증한다.

---

# Phase 10. Production

# 113. Root Standard Commands

최종적으로 Root에서:

```bash
pnpm dev

pnpm build

pnpm lint

pnpm typecheck

pnpm test

pnpm format

pnpm db:migrate

pnpm db:status

pnpm db:revert

pnpm db:seed

pnpm test:e2e
```

형태로 통일한다.

---

# 114. CI

PR:

```text
Install
↓
Lint
↓
Typecheck
↓
Unit Test
↓
Build
```

```bash
pnpm install \
  --frozen-lockfile

pnpm lint

pnpm typecheck

pnpm test

pnpm build
```

가능하면 이후:

```text
Migration Validation

Integration Test

E2E
```

를 추가한다.

---

# 115. Migration CI Rule

Entity를 변경했다면:

```text
Migration 존재 여부
```

를 확인한다.

Code Review checklist:

- [ ] Entity 변경
- [ ] Migration 포함
- [ ] Migration SQL 검토
- [ ] Destructive 변경 확인
- [ ] Rollback 가능성 확인

---

# 116. Production Migration

Production:

```text
synchronize = false
```

유지.

Development용:

```text
migration:run
```

과 Production용 Build 결과를 분리한다.

Production 예:

```bash
pnpm build
```

그 다음:

```bash
typeorm migration:run \
  -d dist/database/data-source.js
```

---

# 117. Production Deploy 순서

```text
Build
↓
Docker Image
↓
Registry Push
↓
Deploy
↓
Migration
↓
API Ready
↓
Health Check
↓
Traffic
```

Migration 실패 상태에서 새 API가 Traffic을 받지 않도록 한다.

---

# 118. Production Docker

```text
apps/web/Dockerfile
apps/api/Dockerfile
```

Multi-stage:

```text
deps
↓
builder
↓
runner
```

Development Compose와 Production Image는 분리한다.

---

# Phase 11. Documentation

# 119. 문서

```text
docs/
├── architecture.md
├── database.md
├── typeorm.md
├── migration.md
├── authentication.md
├── authorization.md
├── api-convention.md
├── frontend-convention.md
├── design-system.md
└── appearance.md
```

---

# 120. typeorm.md

기록:

```text
Entity 규칙

Repository 규칙

QueryBuilder 규칙

Transaction 규칙

Relation 규칙

Cascade 규칙

Index 규칙

Soft Delete 규칙

Naming 규칙
```

---

# 121. migration.md

```text
Migration 생성

Migration 실행

Rollback

Naming

Production Migration

Data Migration

Destructive Migration
```

---

# 122. design-system.md

반드시:

```text
Foundation

Appearance

Semantic Token

Component Token

Component

Domain
```

Dependency를 기록한다.

---

# 123. appearance.md

```text
Theme

Style

Brand

Density

Default Appearance

Project Override

Custom Brand

Persistence

SSR Theme Resolution
```

기록.

---

# Phase 12. Cornerstone 운영 규칙

# 124. TypeORM 규칙

## Entity

- [ ] Domain Module 안에 배치
- [ ] Entity 직접 Response 금지
- [ ] UUID
- [ ] createdAt
- [ ] updatedAt
- [ ] Index 검토
- [ ] Relation 명시

## Repository

- [ ] Service에서 접근
- [ ] Controller 직접 접근 금지
- [ ] Simple Query → Repository
- [ ] Complex Query → QueryBuilder

## Migration

- [ ] synchronize false
- [ ] Entity 변경 → Migration
- [ ] Migration 검토
- [ ] Production 별도 실행

## Transaction

- [ ] 다중 Write 검토
- [ ] Transaction Manager 사용
- [ ] QueryRunner 최소 사용

---

# 125. UI 규칙

## Primitive

```text
색 자체
숫자 자체
Spacing Scale
Radius Scale
```

## Appearance

```text
Theme
Style
Brand
Density
```

## Semantic

```text
background
text
border
primary
success
warning
danger
```

## Component Token

```text
button-height
input-border
card-radius
table-row-height
```

## Component

Appearance의 실제 이름을 몰라야 한다.

---

# 126. 하지 말아야 할 UI 패턴

금지:

```css
.button {
  background: #7c3aed;
}
```

금지:

```css
[data-theme='dark']
  .button {
}
```

Component 안에서 금지:

```text
signal-violet
industrial
compact
dark
```

Component는 Token만 사용한다.

---

# 127. Domain 분리

Cornerstone:

```text
Button
Input
Select
Table
Card
Dialog
Toast
Page
Form
Auth
User
```

Project:

```text
ServerCard
DeployDialog
ProjectStatus
BlogEditor
SchedulePanel
```

---

# 128. Core / Standard / Optional

## Core

- [ ] TypeScript
- [ ] pnpm
- [ ] Turborepo
- [ ] Next.js
- [ ] NestJS
- [ ] PostgreSQL
- [ ] TypeORM
- [ ] Migration
- [ ] Config
- [ ] Validation
- [ ] Error
- [ ] Logger
- [ ] Request ID
- [ ] Health
- [ ] Docker
- [ ] Test
- [ ] CI
- [ ] Foundations
- [ ] Appearance
- [ ] Semantic Tokens

## Standard

- [ ] User
- [ ] Auth
- [ ] AuthSession
- [ ] Refresh
- [ ] Role
- [ ] API Client
- [ ] TanStack Query
- [ ] React Hook Form
- [ ] UI
- [ ] Theme
- [ ] Brand
- [ ] Style
- [ ] Density
- [ ] Layout
- [ ] DataTable
- [ ] Swagger

## Optional

- [ ] Redis 실제 사용
- [ ] OAuth
- [ ] 2FA
- [ ] Mail
- [ ] S3
- [ ] MinIO
- [ ] WebSocket
- [ ] SSE
- [ ] Kafka
- [ ] Elasticsearch
- [ ] Queue
- [ ] Scheduler
- [ ] Notification
- [ ] Audit Log
- [ ] OpenTelemetry
- [ ] Sentry
- [ ] i18n
- [ ] Feature Flag

---

# 129. 최종 완료 체크

## Workspace

- [ ] `pnpm dev`
- [ ] `pnpm build`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`

## Backend

- [ ] Nest
- [ ] Config
- [ ] Error
- [ ] Logger
- [ ] Request Context
- [ ] Swagger

## DB

- [ ] PostgreSQL
- [ ] TypeORM
- [ ] DataSource
- [ ] Migration
- [ ] Rollback
- [ ] Seed
- [ ] Transaction

## Auth

- [ ] Register
- [ ] Login
- [ ] Me
- [ ] Refresh
- [ ] Rotation
- [ ] Logout
- [ ] Role

## Frontend

- [ ] Query
- [ ] Form
- [ ] Auth
- [ ] Protected Route

## Foundations

- [ ] Primitive
- [ ] Typography
- [ ] Spacing
- [ ] Radius
- [ ] Shadow
- [ ] Motion
- [ ] Breakpoint
- [ ] Z-index

## Appearance

- [ ] Light
- [ ] Dark
- [ ] System
- [ ] Industrial
- [ ] Minimal
- [ ] Soft
- [ ] Signal Violet
- [ ] Orange
- [ ] Emerald
- [ ] Custom
- [ ] Compact
- [ ] Default
- [ ] Comfortable

## UI

- [ ] Semantic Token
- [ ] Component Token
- [ ] Button
- [ ] Input
- [ ] Select
- [ ] Dialog
- [ ] Toast
- [ ] FormField
- [ ] Status
- [ ] Layout
- [ ] DataTable

## Test

- [ ] Backend Unit
- [ ] DB Integration
- [ ] Frontend Unit
- [ ] Auth E2E
- [ ] UI Appearance Test

## Production

- [ ] Docker
- [ ] Migration
- [ ] Health
- [ ] CI

---

# 130. 실제 첫 작업 범위

한 번에 전체를 만들지 않는다.

## Milestone 1

```text
Repository
↓
pnpm
↓
Next
↓
Nest
↓
Turbo
↓
pnpm dev
```

완료:

```text
Web 3000
API 4000
```

Commit.

---

## Milestone 2

```text
Docker
↓
PostgreSQL
↓
TypeORM
↓
Entity
↓
Migration
↓
Repository
↓
CRUD
```

Commit.

---

## Milestone 3

```text
Error
↓
Logger
↓
Request Context
↓
Swagger
↓
Auth
↓
Refresh
↓
Authorization
```

Commit.

---

## Milestone 4

```text
API Client
↓
Query
↓
Form
↓
Frontend Auth
```

Commit.

---

## Milestone 5

```text
Foundation
↓
Theme
↓
Brand
↓
Style
↓
Density
↓
Semantic Token
↓
Component Token
```

Commit.

---

## Milestone 6

```text
Button / Input
↓
Form
↓
Dialog / Toast
↓
Layout
↓
DataTable
```

Commit.

---

## Milestone 7

```text
Unit
↓
Integration
↓
E2E
↓
Storybook
↓
CI
↓
Production Docker
```

Starter v1.

---

# 131. Cornerstone의 핵심 원칙

Backend:

```text
Controller
↓
Service
↓
Repository
↓
Entity
↓
Database
```

DB:

```text
Entity 수정
↓
Migration 생성
↓
Migration 검토
↓
Migration 실행
↓
Test
```

Frontend:

```text
Feature
↓
Query / Form
↓
API Client
↓
Backend
```

UI:

```text
Foundation
↓
Appearance
↓
Semantic Token
↓
Component Token
↓
Component
↓
Domain
```

Appearance:

```text
Theme
×
Style
×
Brand
×
Density
```

이 네 흐름이 Cornerstone의 핵심 구조다.

---

# 132. Starter v1 이후

Cornerstone을 실제 프로젝트 1~2개에 사용한 뒤에만 공통 기능을 추가한다.

후보:

```text
Project Generator CLI

OAuth

2FA

Mail

Object Storage

Background Queue

Scheduler

Notification

Audit Log

OpenTelemetry

Generated OpenAPI Client

Feature Flag

Command Palette

Advanced DataTable
```

원칙:

> **필요할 것 같아서 넣지 않는다. 서로 다른 프로젝트에서 실제로 반복된 기능을 Cornerstone으로 승격한다.**

Cornerstone이 거대한 Framework가 되는 것을 막기 위한 가장 중요한 운영 규칙이다.
