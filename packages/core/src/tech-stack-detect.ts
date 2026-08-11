import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Project, TechStackCategory, TechStackEntry } from './types.js';

interface PackageJsonMapping {
  category: TechStackCategory;
  value: string;
}

// ADR-0005 §2 — 짧고 명시적인 매핑. 전체 생태계 커버리지가 아니라 등록 직후 유용한
// 기본값을 무료로 제공하는 것이 목표다.
const PACKAGE_MAPPINGS: Record<string, PackageJsonMapping> = {
  react: { category: 'framework', value: 'React' },
  vue: { category: 'framework', value: 'Vue' },
  '@angular/core': { category: 'framework', value: 'Angular' },
  svelte: { category: 'framework', value: 'Svelte' },
  express: { category: 'framework', value: 'Express' },
  '@nestjs/core': { category: 'framework', value: 'NestJS' },
  fastify: { category: 'framework', value: 'Fastify' },
  koa: { category: 'framework', value: 'Koa' },
  next: { category: 'framework', value: 'Next.js' },
  nuxt: { category: 'framework', value: 'Nuxt' },
  '@remix-run/react': { category: 'framework', value: 'Remix' },
  hono: { category: 'framework', value: 'Hono' },

  typeorm: { category: 'orm', value: 'TypeORM' },
  prisma: { category: 'orm', value: 'Prisma' },
  '@prisma/client': { category: 'orm', value: 'Prisma' },
  sequelize: { category: 'orm', value: 'Sequelize' },
  mongoose: { category: 'orm', value: 'Mongoose' },
  'drizzle-orm': { category: 'orm', value: 'Drizzle ORM' },
  knex: { category: 'orm', value: 'Knex' },

  pg: { category: 'database', value: 'PostgreSQL' },
  postgres: { category: 'database', value: 'PostgreSQL' },
  mysql2: { category: 'database', value: 'MySQL' },
  mysql: { category: 'database', value: 'MySQL' },
  mongodb: { category: 'database', value: 'MongoDB' },
  sqlite3: { category: 'database', value: 'SQLite' },
  'better-sqlite3': { category: 'database', value: 'SQLite' },
  redis: { category: 'database', value: 'Redis' },
  ioredis: { category: 'database', value: 'Redis' },

  vite: { category: 'build_tool', value: 'Vite' },
  webpack: { category: 'build_tool', value: 'webpack' },
  esbuild: { category: 'build_tool', value: 'esbuild' },
  rollup: { category: 'build_tool', value: 'Rollup' },
  tsup: { category: 'build_tool', value: 'tsup' },
  parcel: { category: 'build_tool', value: 'Parcel' },
};

function findPackageJson(project: Project): string | undefined {
  const candidates = [
    path.join(path.dirname(project.tsconfigPath), 'package.json'),
    path.join(project.rootPath, 'package.json'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

/**
 * package.json의 dependencies/devDependencies를 읽어 알려진 패키지를 기술 스택으로 매핑한다.
 * 네트워크 호출이나 버전 파싱은 하지 않는다 — 로컬 파일만 읽는다 (NFR-6, ADR-0005 §4).
 */
export function detectTechStack(project: Project): TechStackEntry[] {
  const entries: TechStackEntry[] = [
    { category: 'language', value: 'TypeScript' },
    { category: 'runtime', value: 'Node.js' },
  ];

  const pkgPath = findPackageJson(project);
  if (!pkgPath) return entries;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const depName of Object.keys(allDeps)) {
      const mapping = PACKAGE_MAPPINGS[depName];
      if (mapping) entries.push({ category: mapping.category, value: mapping.value });
    }
  } catch {
    // package.json이 깨져 있어도 language/runtime 기본값만 반환하고 실패하지 않는다.
  }

  return entries;
}
