import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
