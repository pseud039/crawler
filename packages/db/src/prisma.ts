import { PrismaClient } from '@prisma/client'

// one instance across the whole app
export const db = new PrismaClient()