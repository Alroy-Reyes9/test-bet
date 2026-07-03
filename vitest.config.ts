import { defineConfig } from "vitest/config"
import { config } from "dotenv"

config({ path: ".env.test" })

export default defineConfig({
  test: {
    environment: "node",
    // The ledger's concurrency tests share one DB; run files serially so they don't collide.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
})
