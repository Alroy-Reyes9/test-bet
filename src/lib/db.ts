import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// Prisma 7 removed the `url` datasource field from schema.prisma; the client
// now requires an explicit driver adapter carrying the connection string.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
